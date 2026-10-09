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
import { promisify } from "util";
import * as yieldableJSON from "yieldable-json";
const stringifyAsync = promisify(yieldableJSON.stringifyAsync);
import * as express from "express";

export interface Error {
    readonly code: number;
    readonly reason: string;
    readonly errors: any[];
}

export function responseError(res: express.Response, code: number, reason?: string): express.Response {
    if (reason) {
        // a status message may not contain a newline (a YAML error, `Command failed: …\n<stderr>`):
        // writeHead() would throw and leave the request open. The body keeps the full reason.
        res.writeHead(code, reason.replace(/[^\t\x20-\x7e]/g, " "), {
            "Content-Type": "application/json"
        });
    } else {
        res.writeHead(code, {
            "Content-Type": "application/json"
        });
    }

    const error: Error = {
        code: code,
        reason: reason || null,
        errors: []
    };

    res.end(JSON.stringify(error));

    return res;
}

export function responseStreamErrorHandler(res: express.Response, err: NodeJS.ErrnoException): express.Response {
    if (err.message === "no available tuners") {
        return responseError(res, 503, "Tuner Resource Unavailable");
    }

    return responseError(res, 500, err.message);
}

/**
 * Returns a copy of a request query without sift() operators ("$"-prefixed keys) at any depth.
 * The query is passed to sift(), where $where runs JavaScript and $regex can block the event loop.
 */
export function stripQueryOperators(query: any): any {
    if (query === null || typeof query !== "object") {
        return query;
    }
    if (Array.isArray(query)) {
        return query.map(stripQueryOperators);
    }

    const result: any = {};
    for (const key of Object.keys(query)) {
        if (key.startsWith("$") === false) {
            result[key] = stripQueryOperators(query[key]);
        }
    }

    return result;
}

export async function responseJSON(res: express.Response, body: any): Promise<express.Response> {
    // this is lighter than res.json()
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200);
    res.end(await stringifyAsync(body));

    return res;
}
