FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml ./
COPY packages ./packages
COPY services ./services
ARG SERVICE
RUN --mount=type=cache,target=/root/.m2 mvn -B -pl services/${SERVICE}-service -am package -DskipTests
RUN cp services/${SERVICE}-service/target/${SERVICE}-service-0.1.0-SNAPSHOT.jar /app/service.jar
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S motoros && adduser -S motoros -G motoros
WORKDIR /app
COPY --from=build --chown=motoros:motoros /app/service.jar /app/service.jar
USER motoros
ENV BIND_ADDRESS=0.0.0.0 PORT=8080
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/service.jar"]
