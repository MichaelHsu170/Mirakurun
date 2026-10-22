ARG ARCH=
FROM ${ARCH}node:24.22.1-bookworm AS build
WORKDIR /app
ENV DOCKER=YES NODE_ENV=production
ADD . .
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        build-essential \
        autoconf \
        cmake \
        git \
        libpcsclite-dev
RUN npm ci --include=dev && \
    npm run build && \
    npm ci --omit=dev
# libarib25 and recpt1 are pinned to a commit so every build compiles the same code
RUN cd && git clone https://github.com/stz2012/libarib25.git && cd libarib25 && git checkout 93ff3afd0a13f42724b20564873066f470825e78 && mkdir release && cd release && cmake .. && make && make install && cd .. && rm -rf libarib25
RUN cd && git clone https://github.com/stz2012/recpt1.git && cd recpt1 && git checkout 77c7bce2527e1df45cc8667ede753d09de7b3e6c && cd recpt1 && ./autogen.sh && ./configure --enable-b25 && make && make install && cd .. && rm -rf recpt1
#RUN cd && cp -r /app/recdvb-1.3.3 . && cd recdvb-1.3.3 && ./autogen.sh && ./configure --enable-b25 && make && make install && cd .. && rm -rf recdvb-1.3.3

FROM ${ARCH}node:24.22.1-bookworm-slim
WORKDIR /app
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        make \
        gcc \
        g++ \
        pkg-config \
        pcscd \
        libpcsclite-dev \
        libccid \
        libdvbv5-dev \
        pcsc-tools \
        dvb-tools \
        && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
COPY --from=build /usr/local/lib/libarib25.so.[0-9].* /usr/local/lib
COPY --from=build /usr/local/bin/b25 /usr/local/bin
COPY --from=build /usr/local/bin/checksignal /usr/local/bin
COPY --from=build /usr/local/bin/recpt1 /usr/local/bin
COPY --from=build /usr/local/bin/recpt1ctl /usr/local/bin
#COPY --from=build /usr/local/bin/recdvb /usr/local/bin
#COPY --from=build /usr/local/bin/recdvbctl /usr/local/bin
#COPY --from=build /usr/local/bin/recdvbchksig /usr/local/bin
RUN cd /usr/local/lib && ldconfig -nN . && ldconfig
CMD ["./docker/container-init.sh"]
EXPOSE 40772 9229
