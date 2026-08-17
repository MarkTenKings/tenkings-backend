#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRootEntries = [
  "packages/vault-contracts",
  "packages/vault-machine",
  "frontend/vault-kiosk",
  "frontend/nextjs-app/lib/server/vaultV1",
  "frontend/nextjs-app/pages/api/vault",
  "frontend/nextjs-app/pages/admin/vault.tsx",
  "packages/database/src/vaultV1.ts",
];
const sourceRoots = sourceRootEntries.map((entry) => join(root, entry));
const prismaSchemaPath = join(root, "packages/database/prisma/schema.prisma");
const migrationsRoot = join(root, "packages/database/prisma/migrations");
const sourceExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const ignoredDirectories = new Set(["node_modules", "dist", ".next", ".git", "coverage"]);
const mutationOperations = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const dependencyRules = [
  { code: "SPEEDSTER_DEPENDENCY", pattern: /(?:from\s*|(?:require|import)\(\s*)["'][^"']*speedster/i },
  { code: "LEGACY_VAULT_SERVICE", pattern: /(?:from\s*|(?:require|import)\(\s*)["'][^"']*backend\/vault-service/i },
  { code: "LEGACY_VENDING_GATEWAY", pattern: /(?:from\s*|(?:require|import)\(\s*)["'][^"']*vending-gw/i },
];
const fallbackForbiddenModels = [
  "PackDefinition", "PackInstance", "PackRecipeItem", "Item", "ItemOwnership", "Wallet", "WalletTransaction",
  "KioskSession", "CollectibleCardV2", "CardOwnershipEventV2", "AiGraderV2Session",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lowerFirst(value) {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function snakeCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function addFinding(findings, finding) {
  if (!findings.some((current) => current.code === finding.code && current.file === finding.file && current.line === finding.line)) {
    findings.push(finding);
  }
}

function filesAt(path) {
  if (!existsSync(path)) return [];
  const info = statSync(path);
  if (info.isFile()) return sourceExtension.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => ignoredDirectories.has(name) ? [] : filesAt(join(path, name)));
}

function forbiddenModelsFromSchema(schemaText) {
  const modelNames = [...schemaText.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm)].map((match) => match[1]);
  const derived = modelNames.filter((name) => !name.startsWith("Vault") && (
    /(?:V2|Speedster)/i.test(name)
    || /^(?:Pack|Item|Wallet|Kiosk)/.test(name)
    || /Item$/.test(name)
  ));
  return [...new Set([...fallbackForbiddenModels, ...derived])].sort();
}

function identifierPattern(forbiddenModels) {
  const identifiers = new Set();
  for (const model of forbiddenModels) {
    identifiers.add(model);
    identifiers.add(lowerFirst(model));
    identifiers.add(snakeCase(model));
  }
  const exact = [...identifiers].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  return new RegExp(`(?:speedster|(?<![A-Za-z0-9_])(?:${exact})(?![A-Za-z0-9_]))`, "i");
}

function discoverDatabaseAliases(text) {
  const aliases = new Set(["prisma"]);
  for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*(?:database|@prisma\/client)[^"']*["']/g)) {
    for (const specifier of match[1].split(",")) {
      const parsed = /^\s*prisma(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(specifier);
      if (parsed) aliases.add(parsed[1] ?? "prisma");
    }
  }
  for (const match of text.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*["'][^"']*(?:database|@prisma\/client)[^"']*["']\s*\)/g)) {
    for (const specifier of match[1].split(",")) {
      const parsed = /^\s*prisma(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(specifier);
      if (parsed) aliases.add(parsed[1] ?? "prisma");
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const match of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:\:[^=;]+)?=\s*([A-Za-z_$][\w$]*)\b/g)) {
      if (aliases.has(match[2]) && !aliases.has(match[1])) { aliases.add(match[1]); changed = true; }
    }
    for (const alias of [...aliases]) {
      const receiver = escapeRegExp(alias);
      const transaction = new RegExp(`\\b${receiver}\\b(?:\\.\\$transaction|\\[\\s*["']\\$transaction["']\\s*\\])\\s*\\(\\s*(?:async\\s+)?(?:\\(\\s*)?([A-Za-z_$][\\w$]*)`, "g");
      for (const match of text.matchAll(transaction)) {
        if (!aliases.has(match[1])) { aliases.add(match[1]); changed = true; }
      }
    }
  }
  return aliases;
}

function discoverDelegateAliases(text, databaseAliases, forbiddenModels) {
  const delegateAliases = new Map();
  const delegates = forbiddenModels.map((model) => lowerFirst(model));
  for (const databaseAlias of databaseAliases) {
    const receiver = escapeRegExp(databaseAlias);
    for (const delegate of delegates) {
      const access = `(?:\\.${escapeRegExp(delegate)}\\b|\\[\\s*["']${escapeRegExp(delegate)}["']\\s*\\])`;
      const assignment = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\b${receiver}\\b${access}`, "g");
      for (const match of text.matchAll(assignment)) delegateAliases.set(match[1], delegate);
    }
    const destructuring = new RegExp(`(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*\\b${receiver}\\b`, "g");
    for (const match of text.matchAll(destructuring)) {
      for (const specifier of match[1].split(",")) {
        const parsed = /^\s*([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(specifier);
        if (parsed && delegates.includes(parsed[1])) delegateAliases.set(parsed[2] ?? parsed[1], parsed[1]);
      }
    }
  }
  return delegateAliases;
}

function extractParenthesized(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") { quote = character; continue; }
    if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) return text.slice(openIndex + 1, index);
  }
  return text.slice(openIndex + 1, Math.min(text.length, openIndex + 4000));
}

function extractTemplate(text, tickIndex) {
  let escaped = false;
  for (let index = tickIndex + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === "`") return text.slice(tickIndex + 1, index);
  }
  return text.slice(tickIndex + 1, Math.min(text.length, tickIndex + 4000));
}

function scanSourceText(text, file, forbiddenModels) {
  const findings = [];
  for (const rule of dependencyRules) {
    const match = rule.pattern.exec(text);
    if (match) addFinding(findings, { code: rule.code, file, line: lineAt(text, match.index) });
  }

  const databaseAliases = discoverDatabaseAliases(text);
  const delegateAliases = discoverDelegateAliases(text, databaseAliases, forbiddenModels);
  const delegateAlternatives = forbiddenModels.map((model) => escapeRegExp(lowerFirst(model))).sort((a, b) => b.length - a.length).join("|");
  const operationAlternatives = mutationOperations.join("|");
  for (const alias of databaseAliases) {
    const receiver = escapeRegExp(alias);
    const modelAccess = `(?:\\.(?:${delegateAlternatives})\\b|\\[\\s*["'](?:${delegateAlternatives})["']\\s*\\])`;
    const operationAccess = `(?:\\.(?:${operationAlternatives})\\b|\\[\\s*["'](?:${operationAlternatives})["']\\s*\\])`;
    const mutation = new RegExp(`\\b${receiver}\\b${modelAccess}${operationAccess}\\s*\\(`, "gi");
    for (const match of text.matchAll(mutation)) addFinding(findings, { code: "FORBIDDEN_PRISMA_MUTATION", file, line: lineAt(text, match.index) });

    const rawAccess = `(?:\\.\\$(?:executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)\\b|\\[\\s*["']\\$(?:executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)["']\\s*\\])`;
    const rawCall = new RegExp(`\\b${receiver}\\b${rawAccess}\\s*(\\(|\\x60)`, "g");
    const forbiddenIdentifier = identifierPattern(forbiddenModels);
    for (const match of text.matchAll(rawCall)) {
      const delimiterIndex = match.index + match[0].lastIndexOf(match[1]);
      const sql = match[1] === "(" ? extractParenthesized(text, delimiterIndex) : extractTemplate(text, delimiterIndex);
      if (forbiddenIdentifier.test(sql)) addFinding(findings, { code: "FORBIDDEN_PRISMA_RAW_SQL", file, line: lineAt(text, match.index) });
    }
  }
  for (const [alias] of delegateAliases) {
    const operationAccess = `(?:\\.(?:${operationAlternatives})\\b|\\[\\s*["'](?:${operationAlternatives})["']\\s*\\])`;
    const mutation = new RegExp(`\\b${escapeRegExp(alias)}\\b${operationAccess}\\s*\\(`, "gi");
    for (const match of text.matchAll(mutation)) addFinding(findings, { code: "FORBIDDEN_PRISMA_MUTATION", file, line: lineAt(text, match.index) });
  }
  return findings;
}

function analyzeVaultSchema(schemaText, file, forbiddenModels) {
  const findings = [];
  const forbiddenIdentifier = identifierPattern(forbiddenModels);
  for (const blockMatch of schemaText.matchAll(/^model\s+(Vault[A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm)) {
    const block = blockMatch[0];
    const forbidden = forbiddenIdentifier.exec(block);
    if (forbidden) addFinding(findings, { code: "VAULT_SCHEMA_FORBIDDEN_RELATION", file, line: lineAt(schemaText, blockMatch.index + forbidden.index) });
    for (const relation of block.matchAll(/^\s*[A-Za-z][\w]*\s+([A-Za-z][\w]*)[?\[\]]*\s+@relation\b/gm)) {
      if (!relation[1].startsWith("Vault")) addFinding(findings, { code: "VAULT_SCHEMA_EXTERNAL_RELATION", file, line: lineAt(schemaText, blockMatch.index + relation.index) });
    }
  }
  return findings;
}

function analyzeVaultMigration(sql, file, forbiddenModels) {
  const findings = [];
  const forbidden = identifierPattern(forbiddenModels).exec(sql);
  if (forbidden) addFinding(findings, { code: "VAULT_MIGRATION_FORBIDDEN_REFERENCE", file, line: lineAt(sql, forbidden.index) });
  for (const reference of sql.matchAll(/\bREFERENCES\s+"([^"]+)"/gi)) {
    if (!reference[1].startsWith("Vault")) addFinding(findings, { code: "VAULT_MIGRATION_EXTERNAL_RELATION", file, line: lineAt(sql, reference.index) });
  }
  return findings;
}

function scanCloudHardwareAuthority(text, file) {
  const findings = [];
  const patterns = [
    /\b(?:controller|hardware|relay|serial)\s*(?:\.|\[\s*["'])\s*(?:sendOpenCommand|openDoor|unlockDoor|dispatchDoorCommand)/i,
    /\b(?:sendOpenCommand|openDoor|unlockDoor|remoteUnlock|dispatchDoorCommand)\s*\(/i,
    /(?:fetch|axios\.(?:get|post|put|patch)|request)\s*\(\s*["'`][^"'`\n]*(?:\/open-door|\/unlock-door|\/remote-unlock|\/door-command|\/doors?\/(?:open|unlock))/i,
    /(?:from\s*|require\(\s*)["'][^"']*(?:serialport|node-serialport|\busb\b|node-hid)[^"']*["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) addFinding(findings, { code: "CLOUD_HARDWARE_AUTHORITY", file, line: lineAt(text, match.index) });
  }
  return findings;
}

function runSelfTests() {
  const forbiddenModels = fallbackForbiddenModels;
  let assertions = 0;
  const expectCode = (name, findings, code) => {
    assertions += 1;
    if (!findings.some((finding) => finding.code === code)) throw new Error(`${name} did not trigger ${code}: ${JSON.stringify(findings)}`);
  };
  const expectClean = (name, findings) => {
    assertions += 1;
    if (findings.length) throw new Error(`${name} produced false positives: ${JSON.stringify(findings)}`);
  };

  expectCode("speedster dependency", scanSourceText(`import x from "speedster/client";`, "fixture.ts", forbiddenModels), "SPEEDSTER_DEPENDENCY");
  expectCode("legacy service", scanSourceText(`const x = require("../../backend/vault-service");`, "fixture.ts", forbiddenModels), "LEGACY_VAULT_SERVICE");
  expectCode("legacy gateway", scanSourceText(`import x from "vending-gw";`, "fixture.ts", forbiddenModels), "LEGACY_VENDING_GATEWAY");
  for (const operation of mutationOperations) {
    expectCode(`direct ${operation}`, scanSourceText(`prisma.collectibleCardV2.${operation}({});`, "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_MUTATION");
  }
  expectCode("bracket import alias", scanSourceText(`import { prisma as db } from "@tenkings/database"; db["packDefinition"]["createMany"]({});`, "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_MUTATION");
  expectCode("assigned database alias", scanSourceText(`const db = prisma; db.packInstance.deleteMany({});`, "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_MUTATION");
  expectCode("transaction alias", scanSourceText(`prisma["$transaction"](async (ledger) => ledger["wallet"].updateMany({}));`, "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_MUTATION");
  expectCode("Speedster V2 delegate", scanSourceText(`prisma.aiGraderV2Session.deleteMany({});`, "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_MUTATION");
  expectCode("delegate alias", scanSourceText(`const cards = prisma["collectibleCardV2"]; cards.upsert({});`, "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_MUTATION");
  expectCode("raw SQL call", scanSourceText(`prisma.$executeRawUnsafe("DELETE FROM \\"PackInstance\\"");`, "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_RAW_SQL");
  expectCode("raw SQL bracket/tag", scanSourceText('prisma["$queryRaw"]`SELECT * FROM "CollectibleCardV2"`;', "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_RAW_SQL");
  expectCode("raw SQL transaction alias", scanSourceText('prisma.$transaction(async (tx) => tx["$executeRaw"]`UPDATE "Wallet" SET "balance"=0`);', "fixture.ts", forbiddenModels), "FORBIDDEN_PRISMA_RAW_SQL");
  expectCode("Vault schema relation", analyzeVaultSchema(`model VaultLeak {\n  id String @id\n  card CollectibleCardV2 @relation(fields: [id], references: [id])\n}\n`, "schema.prisma", forbiddenModels), "VAULT_SCHEMA_FORBIDDEN_RELATION");
  expectCode("Vault schema external relation", analyzeVaultSchema(`model VaultLeak {\n  id String @id\n  external UnrelatedDomain @relation(fields: [id], references: [id])\n}\n`, "schema.prisma", forbiddenModels), "VAULT_SCHEMA_EXTERNAL_RELATION");
  expectCode("Vault migration reference", analyzeVaultMigration(`ALTER TABLE "VaultSale" ADD CONSTRAINT "leak" FOREIGN KEY ("id") REFERENCES "PackDefinition"("id");`, "migration.sql", forbiddenModels), "VAULT_MIGRATION_FORBIDDEN_REFERENCE");
  expectCode("Vault migration external relation", analyzeVaultMigration(`ALTER TABLE "VaultSale" ADD CONSTRAINT "leak" FOREIGN KEY ("id") REFERENCES "UnrelatedDomain"("id");`, "migration.sql", forbiddenModels), "VAULT_MIGRATION_EXTERNAL_RELATION");
  expectCode("cloud hardware call", scanCloudHardwareAuthority(`await controller.sendOpenCommand(command);`, "route.ts"), "CLOUD_HARDWARE_AUTHORITY");
  expectCode("cloud hardware endpoint", scanCloudHardwareAuthority(`await fetch("http://machine/api/open-door");`, "route.ts"), "CLOUD_HARDWARE_AUTHORITY");
  expectClean("safe cloud door planning", scanCloudHardwareAuthority(`const boundary = "NO REMOTE UNLOCK"; await prisma.vaultDoor.update({ data: { plannedProductId } });`, "route.ts"));
  assertions += 1;
  if (!sourceRootEntries.includes("frontend/nextjs-app/pages/admin/vault.tsx")) throw new Error("admin Vault TSX scan root is missing");
  return assertions;
}

if (process.argv.includes("--self-test")) {
  try {
    const assertions = runSelfTests();
    process.stdout.write(`${JSON.stringify({ ok: true, selfTestAssertions: assertions }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, selfTestError: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
} else {
  const findings = [];
  const schemaText = existsSync(prismaSchemaPath) ? readFileSync(prismaSchemaPath, "utf8") : "";
  const forbiddenModels = forbiddenModelsFromSchema(schemaText);
  for (const path of sourceRoots.flatMap(filesAt)) {
    const text = readFileSync(path, "utf8");
    for (const finding of scanSourceText(text, relative(root, path), forbiddenModels)) addFinding(findings, finding);
  }
  if (!schemaText) addFinding(findings, { code: "VAULT_SCHEMA_MISSING", file: relative(root, prismaSchemaPath), line: 1 });
  else for (const finding of analyzeVaultSchema(schemaText, relative(root, prismaSchemaPath), forbiddenModels)) addFinding(findings, finding);

  const vaultMigrationPaths = existsSync(migrationsRoot)
    ? readdirSync(migrationsRoot).map((name) => join(migrationsRoot, name, "migration.sql")).filter((path) => {
      if (!existsSync(path)) return false;
      const migrationDirectory = relative(migrationsRoot, path).split(/[\\/]/)[0];
      const sql = readFileSync(path, "utf8");
      return /(?:^|[_-])vault(?:[_-]|$)/i.test(migrationDirectory)
        || /\b(?:CREATE\s+(?:TABLE|TYPE)|ALTER\s+TABLE)\s+"Vault[A-Za-z0-9_]*"/i.test(sql);
    })
    : [];
  if (!vaultMigrationPaths.length) addFinding(findings, { code: "VAULT_MIGRATION_MISSING", file: relative(root, migrationsRoot), line: 1 });
  for (const path of vaultMigrationPaths) {
    const sql = readFileSync(path, "utf8");
    for (const finding of analyzeVaultMigration(sql, relative(root, path), forbiddenModels)) addFinding(findings, finding);
  }

  const cloudRouteRoot = join(root, "frontend/nextjs-app/pages/api/vault");
  for (const path of filesAt(cloudRouteRoot)) {
    for (const finding of scanCloudHardwareAuthority(readFileSync(path, "utf8"), relative(root, path))) addFinding(findings, finding);
  }

  for (const [index, path] of sourceRoots.entries()) {
    if (!existsSync(path)) addFinding(findings, { code: "VAULT_SCAN_ROOT_MISSING", file: sourceRootEntries[index], line: 1 });
  }

  if (findings.length) {
    process.stderr.write(`${JSON.stringify({ ok: false, findings }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      scannedRoots: sourceRootEntries,
      prismaSchema: relative(root, prismaSchemaPath),
      vaultMigrations: vaultMigrationPaths.map((path) => relative(root, path)),
    }, null, 2)}\n`);
  }
}
