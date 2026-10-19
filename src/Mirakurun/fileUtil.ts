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
import { open, rename, stat } from "fs/promises";

/**
 * Writes a file so that a crash leaves either the old or the new content, never a truncated file:
 * write a temporary file next to it, flush it to disk, then rename it over the target.
 * The new file keeps the owner and mode of the file it replaces (the container runs as root, but the
 * config files are edited on the host).
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
    const tmpPath = `${path}.tmp`;
    const target = await stat(path).catch(() => null);
    const handle = await open(tmpPath, "w");
    try {
        if (target !== null) {
            await handle.chown(target.uid, target.gid).catch(err => {
                if (err.code !== "EPERM") {
                    throw err;
                }
            });
            await handle.chmod(target.mode & 0o7777);
        }
        await handle.writeFile(data);
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(tmpPath, path);
}
