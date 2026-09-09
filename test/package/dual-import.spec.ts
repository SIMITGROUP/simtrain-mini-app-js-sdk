import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(__dirname, "../..");
const packageName = "@simitgroup/simtrain-mini-app-js-sdk";

type Probe = {
  exports: string[];
  constructorName: string;
  hasAuth: boolean;
  hasResources: boolean;
  hasControls: boolean;
  isolatedAuth: boolean;
  isolatedResources: boolean;
  postedMessages: number;
};

function runProbe(kind: "esm" | "cjs"): Probe {
  const source =
    kind === "esm"
      ? `let postedMessages = 0;
         globalThis.window = {parent:{postMessage(){postedMessages += 1;}},addEventListener(){},removeEventListener(){}};
         const sdk = await import(${JSON.stringify(packageName)});
         const first = new sdk.SimTrainSdk();
         const second = new sdk.SimTrainSdk();
         console.log(JSON.stringify({exports:Object.keys(sdk).sort(),constructorName:first.constructor.name,hasAuth:typeof first.auth?.getToken==='function',hasResources:typeof first.students?.list==='function'&&typeof first.me?.get==='function',hasControls:typeof first.ui?.navigateTo==='function'&&typeof first.current?.navigateTo==='function',isolatedAuth:first.auth!==second.auth,isolatedResources:first.students!==second.students,postedMessages}));
         first.dispose(); second.dispose();`
      : `let postedMessages = 0;
         globalThis.window = {parent:{postMessage(){postedMessages += 1;}},addEventListener(){},removeEventListener(){}};
         const sdk = require(${JSON.stringify(packageName)});
         const first = new sdk.SimTrainSdk();
         const second = new sdk.SimTrainSdk();
         console.log(JSON.stringify({exports:Object.keys(sdk).sort(),constructorName:first.constructor.name,hasAuth:typeof first.auth?.getToken==='function',hasResources:typeof first.students?.list==='function'&&typeof first.me?.get==='function',hasControls:typeof first.ui?.navigateTo==='function'&&typeof first.current?.navigateTo==='function',isolatedAuth:first.auth!==second.auth,isolatedResources:first.students!==second.students,postedMessages}));
         first.dispose(); second.dispose();`;
  const args =
    kind === "esm"
      ? ["--input-type=module", "--eval", source]
      : ["--eval", source];
  return JSON.parse(
    execFileSync(process.execPath, args, {
      cwd: packageRoot,
      encoding: "utf8",
    })
  ) as Probe;
}

function packedFiles(): string[] {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toLowerCase().startsWith("npm_config_")
    )
  );
  const output = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...environment,
        npm_config_cache: mkdtempSync(
          join(tmpdir(), "simtrain-sdk-npm-cache-")
        ),
      },
    }
  );
  const result = JSON.parse(output) as Array<{
    readonly files: ReadonlyArray<{ readonly path: string }>;
  }>;
  return result[0]?.files.map(file => file.path).sort() ?? [];
}

describe("published package conditions", () => {
  it("is configured for a public V2-only npm release", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8")
    ) as {
      readonly name?: string;
      readonly publishConfig?: {
        readonly access?: string;
        readonly registry?: string;
      };
      readonly scripts?: { readonly prepack?: string };
    };
    expect(packageJson.name).toBe("@simitgroup/simtrain-mini-app-js-sdk");
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
    });
    expect(packageJson.scripts?.prepack).toBe("pnpm build");
  });

  it("exposes the same isolated constructor through ESM and CommonJS", () => {
    const esm = runProbe("esm");
    const cjs = runProbe("cjs");

    expect(esm.exports).toEqual(cjs.exports);
    expect(esm.exports).toEqual([
      "SimTrainApiError",
      "SimTrainSdk",
      "SimTrainSdkError",
    ]);
    expect(esm.constructorName).toBe("SimTrainSdk");
    expect(esm.hasAuth).toBe(true);
    expect(esm.hasResources).toBe(true);
    expect(esm.hasControls).toBe(true);
    expect(esm.isolatedAuth).toBe(true);
    expect(esm.isolatedResources).toBe(true);
    expect(esm.postedMessages).toBe(0);
    expect(cjs).toMatchObject({
      constructorName: "SimTrainSdk",
      hasAuth: true,
      hasResources: true,
      hasControls: true,
      isolatedAuth: true,
      isolatedResources: true,
      postedMessages: 0,
    });
  });

  it("packs only the reviewed public artifacts and package manifest", () => {
    const files = packedFiles();

    expect(files).toEqual(
      expect.arrayContaining([
        "LICENSE",
        "README.md",
        "docs/token-verification.md",
        "dist/index.cjs",
        "dist/index.cjs.map",
        "dist/index.d.mts",
        "dist/index.d.ts",
        "dist/index.mjs",
        "dist/index.mjs.map",
        "package.json",
      ])
    );
    expect(
      files.every(
        file =>
          file === "LICENSE" ||
          file === "README.md" ||
          file === "package.json" ||
          file === "docs/token-verification.md" ||
          file.startsWith("dist/")
      )
    ).toBe(true);
  });
});
