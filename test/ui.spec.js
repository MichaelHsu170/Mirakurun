const { describe, it, before, after } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ts = require("typescript");

// the UI is built by webpack only; transpile the modules under test to CommonJS for node
let ui;
let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-ui-"));
  for (const name of ["ui", "common", "regexp"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "modules", `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    fs.writeFileSync(path.join(dir, `${name}.js`), outputText);
  }
  ui = require(path.join(dir, "ui.js"));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("[ui.spec] ui.ts: autoLink()", () => {
  it("escapes HTML in broadcast text", () => {
    assert.strictEqual(ui.autoLink("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  });

  it("does not let a quote in a URL leave the href attribute", () => {
    const html = ui.autoLink('https://a.example/"onmouseover="alert(1)');

    assert.ok(!/href="[^"]*"onmouseover/.test(html), html);
    assert.ok(html.includes('href="https://a.example/&quot;onmouseover=&quot;alert(1)"'), html);
  });

  it("does not let a full-width quote normalize into the href attribute", () => {
    const html = ui.autoLink("ｈｔｔｐｓ：／／ａ．ｅｘ／＂ｏｎｆｏｃｕｓ＝＂ａｌｅｒｔ（１）");

    assert.ok(!html.includes('"onfocus='), html);
    assert.ok(html.includes("&quot;onfocus=&quot;alert(1)"), html);
  });

  it("still links plain URLs", () => {
    assert.strictEqual(
      ui.autoLink("詳しくは https://www.nhk.jp/p/ts/ まで"),
      '詳しくは <a referrerpolicy="no-referrer" target="_blank" href="https://www.nhk.jp/p/ts/" title="外部サイト">https://www.nhk.jp/p/ts/</a> まで'
    );
  });
});
