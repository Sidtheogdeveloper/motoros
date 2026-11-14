"""Consume trusted SNS deliveries from a dedicated SQS history queue."""
import json
import logging
import os
from contextlib import closing
from urllib.parse import urlsplit
from datetime import UTC, datetime
from threading import Event
from uuid import UUID

logger = logging.getLogger("motoros.intelligence.events")
EVENT_TYPES = {
    "customer": {"VehicleUpdated"},
    "workorder": {"WorkOrderCompleted", "VehicleDelivered", "WorkOrderStatusChanged"},
}


def consume(store, body, topics):
    try:
        notification = json.loads(body)
        if notification["Type"] != "Notification":
            return
        event = json.loads(notification["Message"])
        producer = event["producer"]
        if (notification["TopicArn"] != topics.get(producer)
                or event["eventType"] not in EVENT_TYPES.get(producer, ())
                or event["eventVersion"] != 1):
            return
        tenant = str(UUID(event["tenantId"]))
        aggregate = str(UUID(event["aggregateId"]))
        if aggregate != event["payload"]["resourceId"]:
            return
        if producer == "customer" and event["aggregateType"] == "vehicles":
            vehicle = aggregate
        elif producer == "workorder" and event["aggregateType"] == "work_orders":
            vehicle = str(UUID(event["payload"]["vehicleId"]))
        else:
            return
        occurred = datetime.fromisoformat(event["occurredAt"])
        if occurred.tzinfo is None:
            return
        watermark = occurred.astimezone(UTC).isoformat(timespec="microseconds") + "/" + str(UUID(event["eventId"]))
    except (KeyError, ValueError, TypeError, AttributeError):
        logger.warning("history_event_invalid")
        return
    store.invalidate(tenant, vehicle, watermark)


def poll(store, stop: Event, queue_url, topics, endpoint):
    import boto3
    from botocore.config import Config

    region = os.getenv("AWS_REGION", "ap-south-1")
    options = {"region_name": region, "config": Config(
        connect_timeout=2, read_timeout=8, retries={"total_max_attempts": 1},
    )}
    if endpoint:
        options.update(endpoint_url=endpoint, aws_access_key_id="local-emulator",
                       aws_secret_access_key="local-emulator")
    with_client = boto3.client("sqs", **options)
    try:
        while not stop.is_set():
            try:
                messages = with_client.receive_message(
                    QueueUrl=queue_url, MaxNumberOfMessages=5, WaitTimeSeconds=3,
                ).get("Messages", [])
                for message in messages:
                    consume(store, message["Body"], topics)
                    with_client.delete_message(QueueUrl=queue_url, ReceiptHandle=message["ReceiptHandle"])
            except Exception:
                logger.warning("history_event_poll_failed")
                stop.wait(3)
    finally:
        with_client.close()



def bootstrap_local(endpoint):
    """Set up the dedicated queue only on the configured local emulator."""
    import boto3
    from botocore.config import Config

    url = urlsplit(endpoint or "")
    if (url.scheme != "http" or url.hostname not in
            {"127.0.0.1", "localhost", "host.docker.internal", "localstack"}
            or url.port != 4566 or url.username or url.password or url.path not in ("", "/")
            or url.query or url.fragment):
        raise RuntimeError("Local history events require a LocalStack endpoint on port 4566.")

    region = os.getenv("AWS_REGION", "ap-south-1")
    prefix = os.getenv("AI_MESSAGING_PREFIX", "motoros")
    settings = {"endpoint_url": endpoint, "region_name": region,
                "aws_access_key_id": "local-emulator", "aws_secret_access_key": "local-emulator",
                "config": Config(connect_timeout=2, read_timeout=5, retries={"total_max_attempts": 1})}
    with closing(boto3.client("sns", **settings)) as sns, closing(boto3.client("sqs", **settings)) as sqs:
        topics = {producer: sns.create_topic(Name=f"{prefix}-{producer}-v1")["TopicArn"]
                  for producer in EVENT_TYPES}
        queue = sqs.create_queue(QueueName=f"{prefix}-ai-history-v1")["QueueUrl"]
        arn = sqs.get_queue_attributes(QueueUrl=queue, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
        sqs.set_queue_attributes(QueueUrl=queue, Attributes={"Policy": json.dumps({
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow", "Principal": {"Service": "sns.amazonaws.com"},
                "Action": "sqs:SendMessage", "Resource": arn,
                "Condition": {"ArnEquals": {"aws:SourceArn": list(topics.values())}},
            }],
        })})
        for topic in topics.values():
            sns.subscribe(TopicArn=topic, Protocol="sqs", Endpoint=arn)
    return queue, topics
