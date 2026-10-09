/*
   Copyright 2016 kanreisa

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
Buffer.poolSize = 0; // disable memory pool

require("dotenv").config();
import { execSync } from "child_process";
import { createHash } from "crypto";

if (process.platform !== "linux") {
    console.warn("running in not linux!");
}

if (process.getuid() === 0) {
    try {
        execSync(`renice -n -10 -p ${ process.pid }`);
        execSync(`ionice -c 1 -n 7 -p ${ process.pid }`);
    } catch (e) {
        console.warn("error on modify nice: " + (e as Error).message);
    }
} else {
    console.warn("running in not root!");
}

process.title = "Mirakurun: Server";

process.on("uncaughtException", err => {
    ++status.errorCount.uncaughtException;
    console.error(err.stack);
});
process.on("unhandledRejection", err => {
    ++status.errorCount.unhandledRejection;
    console.error(err);
});
// docker stop and container-init.sh's restart send SIGTERM: save the pending program and service
// changes first, which are otherwise written only by their timers (programs up to 5 min later).
// Both are awaited even if one fails, so a failed save does not cut off the other.
const SHUTDOWN_SAVE_TIMEOUT = 25 * 1000;
let isExiting = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
        if (isExiting) {
            return;
        }
        isExiting = true;
        log.info("%s received, saving pending changes...", signal);
        // a hung write must not keep the process alive: container-init.sh's restart waits for it with no
        // limit (docker stop kills it after stop_grace_period, 30 s in docker-compose.yml).
        // process.exit() would itself wait for the libuv thread that is stuck in the write, so kill instead
        setTimeout(() => {
            console.error("saving pending changes timed out, exiting without them");
            process.kill(process.pid, "SIGKILL");
        }, SHUTDOWN_SAVE_TIMEOUT).unref();
        Promise.allSettled([_.service?.flush(), _.program?.flush()])
            .then(results => {
                for (const result of results) {
                    if (result.status === "rejected") {
                        console.error(result.reason);
                    }
                }
            })
            .finally(() => process.exit(0));
    });
}

function setEnv(name: string, value: string) {
    process.env[name] = process.env[name] || value;
}
setEnv("SERVER_CONFIG_PATH", "/usr/local/etc/mirakurun/server.yml");
setEnv("TUNERS_CONFIG_PATH", "/usr/local/etc/mirakurun/tuners.yml");
setEnv("CHANNELS_CONFIG_PATH", "/usr/local/etc/mirakurun/channels.yml");
setEnv("SERVICES_DB_PATH", "/usr/local/var/db/mirakurun/services.json");
setEnv("PROGRAMS_DB_PATH", "/usr/local/var/db/mirakurun/programs.json");
setEnv("LOGO_DATA_DIR_PATH", "/usr/local/var/db/mirakurun/logo-data");

import _ from "./Mirakurun/_";
import status from "./Mirakurun/status";
import Event from "./Mirakurun/Event";
import Job from "./Mirakurun/Job";
import Tuner from "./Mirakurun/Tuner";
import Channel from "./Mirakurun/Channel";
import Service from "./Mirakurun/Service";
import Program from "./Mirakurun/Program";
import Server from "./Mirakurun/Server";
import * as config from "./Mirakurun/config";
import * as log from "./Mirakurun/log";

(async function top() {
    _.config.server = await config.loadServer();
    _.config.channels = await config.loadChannels();
    _.configIntegrity.channels = createHash("sha256").update(JSON.stringify(_.config.channels)).digest("base64");
    _.config.tuners = await config.loadTuners();

    if (typeof _.config.server.logLevel === "number") {
        (<any> log).logLevel = _.config.server.logLevel;
    }
    if (typeof _.config.server.maxLogHistory === "number") {
        (<any> log).maxLogHistory = _.config.server.maxLogHistory;
    }

    _.event = new Event();
    _.job = new Job();
    _.tuner = new Tuner();
    _.channel = new Channel();
    _.service = new Service();
    _.program = new Program();
    _.server = new Server();

    await _.service.load();
    await _.program.load();

    if (process.env.SETUP === "true") {
        log.info("setup is done.");
        process.exit(0);
    }

    _.server.init();
})().catch(err => {
    // without this a startup failure (e.g. an empty or broken config file) is only logged as an
    // unhandled rejection and the process keeps running without a server, so it is never restarted
    console.error(err);
    process.exit(1);
});
