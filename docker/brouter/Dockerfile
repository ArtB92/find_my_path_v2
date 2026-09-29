FROM eclipse-temurin:21-jre

# Falls back to the latest release if this one is ever removed.
ARG BROUTER_VERSION=1.7.8

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/brouter
RUN set -eu; \
    url="https://github.com/abrensch/brouter/releases/download/v${BROUTER_VERSION}/brouter-${BROUTER_VERSION}.zip"; \
    if ! curl -fsSL -o brouter.zip "$url"; then \
      url=$(curl -fsSL https://api.github.com/repos/abrensch/brouter/releases/latest | jq -r '.assets[] | select(.name | endswith(".zip")) | .browser_download_url' | head -n1); \
      curl -fsSL -o brouter.zip "$url"; \
    fi; \
    unzip -q brouter.zip -d release; \
    cp "$(find release -name 'brouter-*-all.jar' | head -n1)" brouter.jar; \
    cp -r "$(find release -type d -name profiles2 | head -n1)" profiles2; \
    rm -rf release brouter.zip; \
    mkdir -p segments4 customprofiles

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 5x5 degree tiles to route on. E0_N45 covers Île-de-France. All of mainland France:
# W5_N40 W5_N45 W5_N50 E0_N40 E0_N45 E0_N50 E5_N40 E5_N45
ENV BROUTER_TILES="E0_N45" \
    BROUTER_THREADS=4 \
    JAVA_OPTS="-Xmx1g -Xms256m"

EXPOSE 17777
ENTRYPOINT ["/entrypoint.sh"]
