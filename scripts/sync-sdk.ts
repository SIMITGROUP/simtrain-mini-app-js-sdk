import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  assertContractLock,
  createContractLock,
  readContractLock,
  writeContractLockAtomic,
} from "./generator/contract-lock";
import { loadSdkContract } from "./generator/openapi-loader";
import { renderOperationProject } from "./generator/operation-renderer";
import { writeGeneratedProject } from "./generator/project-writer";
import {
  buildSchemaGraph,
  collectOperationSchemaRoots,
} from "./generator/schema-graph";
import { parseSyncOptions } from "./generator/sync-options";
import { renderDtoFiles } from "./generator/type-renderer";

const GENERATOR_VERSION = "simtrain-sdk-generator/1";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = resolve(repositoryRoot, "contract.lock.json");

async function main(): Promise<void> {
  const options = parseSyncOptions(process.argv.slice(2));
  const contract = loadSdkContract(options.source);
  if (options.updateLock) {
    const lock = createContractLock(options.source, GENERATOR_VERSION);
    writeContractLockAtomic(lockPath, lock);
    console.log(
      `Locked ${String(contract.operations.length)} browser operations and ${String(Object.keys(contract.schemas).length)} schemas.`
    );
    return;
  }

  const lock = readContractLock(lockPath);
  assertContractLock(lock, options.source, GENERATOR_VERSION);
  const operationProject = renderOperationProject(contract.operations);
  const generatedFiles = new Map(operationProject.generatedFiles);
  for (const [name, content] of renderDtoFiles(
    buildSchemaGraph(
      contract.schemas,
      collectOperationSchemaRoots(contract.operations)
    )
  )) {
    generatedFiles.set(`src/generated/dto/${name}`, content);
  }
  const result = await writeGeneratedProject(
    repositoryRoot,
    { generatedFiles, editableFiles: operationProject.editableFiles },
    options.check
  );
  for (const orphan of result.orphanedEditableFiles) {
    console.warn(`Orphaned editable resource preserved: ${orphan}`);
  }
  const verb = options.check ? "Checked" : "Loaded";
  console.log(
    `${verb} ${String(contract.operations.length)} browser operations and ${String(Object.keys(contract.schemas).length)} schemas from the locked OpenAPI contract.`
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`SDK contract sync failed: ${message}`);
  process.exitCode = 1;
});
