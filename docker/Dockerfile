ARG ARCH=
FROM ${ARCH}node:18.15.0-buster AS build
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
RUN npm install --production=false && \
    npm run build && \
    npm install -g --unsafe-perm --production
RUN cd && git clone https://github.com/stz2012/libarib25.git && cd libarib25 && mkdir release && cd release && cmake .. && make && make install && cd .. && rm -rf libarib25
RUN cd && git clone https://github.com/stz2012/recpt1.git && cd recpt1/recpt1 && ./autogen.sh && ./configure --enable-b25 && make && make install && cd .. && rm -rf recpt1
#RUN cd && cp -r /app/recdvb-1.3.3 . && cd recdvb-1.3.3 && ./autogen.sh && ./configure --enable-b25 && make && make install && cd .. && rm -rf recdvb-1.3.3

FROM ${ARCH}node:18.15.0-buster-slim
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
COPY --from=build /usr/local/lib/node_modules/mirakurun /app
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
