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
import { Operation } from "express-openapi";
import * as api from "../../../api";
import _ from "../../../_";

export const parameters = [
    {
        in: "path",
        name: "id",
        type: "integer",
        minimum: 10000000000,
        maximum: 655356553565535,
        required: true
    },
    {
        in: "header",
        name: "X-Mirakurun-Priority",
        type: "integer",
        minimum: 0
    },
    {
        in: "query",
        name: "decode",
        type: "integer",
        minimum: 0,
        maximum: 1
    }
];

export const get: Operation = (req, res) => {
    const program = _.program.get(req.params.id as any as number);

    if (program === null) {
        api.responseError(res, 404);
        return;
    }

    const userId = (req.ip || "unix") + ":" + (req.socket.remotePort || Date.now());

    // HEAD request support
    if (req.method === "HEAD") {
        res.setHeader("Content-Type", "video/MP2T");
        res.setHeader("X-Mirakurun-Tuner-User-ID", userId);
        res.status(200).end();
        return;
    }

    let requestAborted = false;
    req.once("close", () => requestAborted = true);

    (<any> res.socket)._writableState.highWaterMark = Math.max(res.writableHighWaterMark, 1024 * 1024 * 16);
    res.socket.setNoDelay(true);

    _.tuner.initProgramStream(program, {
        id: userId,
        priority: parseInt(req.get("X-Mirakurun-Priority"), 10) || 0,
        agent: req.get("User-Agent"),
        url: req.url,
        disableDecoder: (<number> <any> req.query.decode === 0)
    }, res)
        .then(tsFilter => {
            if (requestAborted === true || req.aborted === true) {
                return tsFilter.close();
            }

            req.once("close", () => tsFilter.close());

            res.setHeader("Content-Type", "video/MP2T");
            res.setHeader("X-Mirakurun-Tuner-User-ID", userId);
            res.status(200);

            // cut the stream after 10 minutes without data, but not while TSFilter waits for a delayed program
            // to start (nothing is written until then): TSFilter ends that wait itself, by the program's end
            // (+3 minutes if its duration is undetermined). The program's end + 5 minutes is a backstop.
            const timeout = 1000 * 60 * 10;
            res.setTimeout(timeout, () => {
                if (res.headersSent === false && Date.now() < program.startAt + program.duration + 1000 * 60 * 5) {
                    res.setTimeout(timeout);
                    return;
                }
                res.destroy();
            });
        })
        .catch((err) => api.responseStreamErrorHandler(res, err));
};

get.apiDoc = {
    tags: ["programs", "stream"],
    operationId: "getProgramStream",
    produces: ["video/MP2T"],
    responses: {
        200: {
            description: "OK",
            headers: {
                "X-Mirakurun-Tuner-User-ID": {
                    type: "string"
                }
            }
        },
        404: {
            description: "Not Found"
        },
        503: {
            description: "Tuner Resource Unavailable"
        },
        default: {
            description: "Unexpected Error"
        }
    }
};

// HEAD request support
export const head: Operation = (...args) => get(...args);

head.apiDoc = {
    ...get.apiDoc,
    operationId: undefined
};
