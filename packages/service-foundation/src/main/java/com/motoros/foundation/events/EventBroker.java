package com.motoros.foundation.events;

import com.motoros.foundation.Records;
import java.net.URI;
import java.time.Duration;
import java.util.*;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.*;

/** Logical topics/consumer names resolve to deployment configuration, never business queue URLs. */
public final class EventBroker implements AutoCloseable {
  public final SnsClient sns;
  public final SqsClient sqs;
  private final String prefix, region, account;
  private final boolean emulator;
  private final Map<String, String> queues = new java.util.concurrent.ConcurrentHashMap<>();
  private io.opentelemetry.api.OpenTelemetry telemetry = io.opentelemetry.api.OpenTelemetry.noop();

  public EventBroker telemetry(io.opentelemetry.api.OpenTelemetry telemetry) {
    this.telemetry = telemetry;
    return this;
  }

  public EventBroker(String endpoint, String region, String account, String prefix) {
    this.prefix = prefix;
    this.region = region;
    this.account = account;
    this.emulator = !endpoint.isBlank();
    var s = SnsClient.builder().region(Region.of(region));
    var q = SqsClient.builder().region(Region.of(region));
    var override =
        software.amazon.awssdk.core.client.config.ClientOverrideConfiguration.builder()
            .apiCallTimeout(Duration.ofSeconds(15))
            .apiCallAttemptTimeout(Duration.ofSeconds(10))
            .build();
    s.overrideConfiguration(override);
    q.overrideConfiguration(override);
    if (!endpoint.isBlank()) {
      URI uri = URI.create(endpoint);
      if (!Set.of("127.0.0.1", "localhost", "localstack").contains(uri.getHost()))
        throw new IllegalArgumentException("Emulator endpoint must be local");
      var credentials =
          StaticCredentialsProvider.create(
              AwsBasicCredentials.create("local-emulator", "local-emulator"));
      s.endpointOverride(uri).credentialsProvider(credentials);
      q.endpointOverride(uri).credentialsProvider(credentials);
    }
    sns = s.build();
    sqs = q.build();
  }

  public String topic(String producer) {
    if (!EventEnvelope.TYPES.containsKey(producer)) throw new IllegalArgumentException();
    return "arn:aws:sns:" + region + ":" + account + ":" + prefix + "-" + producer + "-v1";
  }

  public String queue(String consumer) {
    return queues.computeIfAbsent(
        consumer, c -> sqs.getQueueUrl(b -> b.queueName(prefix + "-" + c + "-v1")).queueUrl());
  }

  public boolean emulator() {
    return emulator;
  }

  public String localGeneration() {
    if (!emulator) throw new IllegalStateException("Emulator recovery is local-only");
    return sqs.getQueueAttributes(
            b ->
                b.queueUrl(queue("notification"))
                    .attributeNames(QueueAttributeName.CREATED_TIMESTAMP))
        .attributes()
        .get(QueueAttributeName.CREATED_TIMESTAMP);
  }

  public void publish(EventEnvelope event) {
    Map<String, String> trace = new HashMap<>();
    telemetry
        .getPropagators()
        .getTextMapPropagator()
        .inject(io.opentelemetry.context.Context.current(), trace, Map::put);
    Map<String, software.amazon.awssdk.services.sns.model.MessageAttributeValue> attributes =
        new HashMap<>();
    trace.forEach(
        (k, v) ->
            attributes.put(
                k,
                software.amazon.awssdk.services.sns.model.MessageAttributeValue.builder()
                    .dataType("String")
                    .stringValue(v)
                    .build()));
    sns.publish(
        b ->
            b.topicArn(topic(event.producer()))
                .message(Records.json(event))
                .messageAttributes(attributes));
  }

  public io.opentelemetry.context.Scope parent(String body) {
    try {
      var wrapper = Records.object(body);
      var attributes =
          wrapper.containsKey("MessageAttributes")
              ? Records.object(wrapper.get("MessageAttributes"))
              : Map.<String, Object>of();
      return telemetry
          .getPropagators()
          .getTextMapPropagator()
          .extract(
              io.opentelemetry.context.Context.current(),
              attributes,
              new io.opentelemetry.context.propagation.TextMapGetter<Map<String, Object>>() {
                public Iterable<String> keys(Map<String, Object> carrier) {
                  return carrier.keySet();
                }

                public String get(Map<String, Object> carrier, String key) {
                  if (carrier == null || carrier.get(key) == null) return null;
                  return Objects.toString(Records.object(carrier.get(key)).get("Value"), null);
                }
              })
          .makeCurrent();
    } catch (Exception e) {
      return io.opentelemetry.context.Context.current().makeCurrent();
    }
  }

  public List<Message> receive(String consumer) {
    return sqs.receiveMessage(
            b ->
                b.queueUrl(queue(consumer))
                    .maxNumberOfMessages(5)
                    .waitTimeSeconds(2)
                    .visibilityTimeout(60)
                    .messageSystemAttributeNames(
                        MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT))
        .messages();
  }

  public EventEnvelope decode(String body) {
    var wrapper = Records.object(body);
    if (!"Notification".equals(wrapper.get("Type")))
      throw new IllegalArgumentException("UNTRUSTED_TRANSPORT");
    var event = EventEnvelope.read(String.valueOf(wrapper.get("Message")));
    if (!topic(event.producer()).equals(wrapper.get("TopicArn")))
      throw new IllegalArgumentException("UNTRUSTED_TOPIC");
    return event;
  }

  public void acknowledge(String consumer, Message message) {
    sqs.deleteMessage(b -> b.queueUrl(queue(consumer)).receiptHandle(message.receiptHandle()));
  }

  public void retry(String consumer, Message message, int attempt) {
    sqs.changeMessageVisibility(
        b ->
            b.queueUrl(queue(consumer))
                .receiptHandle(message.receiptHandle())
                .visibilityTimeout(EventStore.backoff(attempt)));
  }

  public void quarantine(String consumer, Message message) {
    sqs.sendMessage(b -> b.queueUrl(queue(consumer + "-dlq")).messageBody(message.body()));
    acknowledge(consumer, message);
  }

  /** Local-only bootstrap. Production topology/policies are deployment-owned. */
  private String ensureQueue(String name, Map<QueueAttributeName, String> attributes) {
    String url;
    try {
      url = sqs.getQueueUrl(b -> b.queueName(name)).queueUrl();
    } catch (QueueDoesNotExistException e) {
      url = sqs.createQueue(b -> b.queueName(name)).queueUrl();
    }
    final String queueUrl = url;
    sqs.setQueueAttributes(b -> b.queueUrl(queueUrl).attributes(attributes));
    return url;
  }

  public void bootstrap() {
    for (String producer : EventEnvelope.TYPES.keySet())
      sns.createTopic(b -> b.name(prefix + "-" + producer + "-v1"));
    for (String consumer : List.of("notification", "analytics", "workorder-approval")) {
      String dlq =
          ensureQueue(
              prefix + "-" + consumer + "-dlq-v1",
              Map.of(
                  QueueAttributeName.MESSAGE_RETENTION_PERIOD,
                  "1209600",
                  QueueAttributeName.SQS_MANAGED_SSE_ENABLED,
                  "true"));
      String dlqArn =
          sqs.getQueueAttributes(b -> b.queueUrl(dlq).attributeNames(QueueAttributeName.QUEUE_ARN))
              .attributes()
              .get(QueueAttributeName.QUEUE_ARN);
      String url =
          ensureQueue(
              prefix + "-" + consumer + "-v1",
              Map.of(
                  QueueAttributeName.VISIBILITY_TIMEOUT,
                  "60",
                  QueueAttributeName.RECEIVE_MESSAGE_WAIT_TIME_SECONDS,
                  "20",
                  QueueAttributeName.MESSAGE_RETENTION_PERIOD,
                  "345600",
                  QueueAttributeName.SQS_MANAGED_SSE_ENABLED,
                  "true",
                  QueueAttributeName.REDRIVE_POLICY,
                  Records.json(Map.of("deadLetterTargetArn", dlqArn, "maxReceiveCount", 5))));
      String arn =
          sqs.getQueueAttributes(b -> b.queueUrl(url).attributeNames(QueueAttributeName.QUEUE_ARN))
              .attributes()
              .get(QueueAttributeName.QUEUE_ARN);
      var producers =
          consumer.equals("workorder-approval") ? Set.of("billing") : EventEnvelope.TYPES.keySet();
      var statements = new ArrayList<Map<String, Object>>();
      for (String producer : producers) {
        statements.add(
            Map.of(
                "Effect",
                "Allow",
                "Principal",
                Map.of("Service", "sns.amazonaws.com"),
                "Action",
                "sqs:SendMessage",
                "Resource",
                arn,
                "Condition",
                Map.of(
                    "ArnEquals",
                    Map.of("aws:SourceArn", topic(producer)),
                    "StringEquals",
                    Map.of("aws:SourceAccount", account))));
        sns.subscribe(
            b ->
                b.topicArn(topic(producer))
                    .protocol("sqs")
                    .endpoint(arn)
                    .attributes(Map.of("RawMessageDelivery", "false")));
      }
      sqs.setQueueAttributes(
          b ->
              b.queueUrl(url)
                  .attributes(
                      Map.of(
                          QueueAttributeName.POLICY,
                          Records.json(Map.of("Version", "2012-10-17", "Statement", statements)))));
    }
  }

  public void close() {
    sns.close();
    sqs.close();
  }
}
