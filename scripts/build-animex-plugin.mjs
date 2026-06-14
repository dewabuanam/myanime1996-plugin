import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { animexPluginArtifact } from '../src/animexPlugin.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(currentDir, '../dist/animex.plugin.json');

function assertNonEmptyStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty string array.`);
  }

  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`Expected ${fieldName} entries to be non-empty strings.`);
    }
  }
}

function validateArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('Artifact is missing.');
  }

  if (artifact.schemaVersion !== 2) {
    throw new Error('Artifact schemaVersion must be 2.');
  }

  if (artifact.compatibilityApiVersion !== '1.0') {
    throw new Error('Artifact compatibilityApiVersion must be 1.0.');
  }

  const plugin = artifact.plugin;
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Artifact.plugin is required.');
  }

  if (plugin.compatibilityApiVersion !== '1.0') {
    throw new Error('Plugin compatibilityApiVersion must be 1.0.');
  }

  if (!plugin.hostRequirements || typeof plugin.hostRequirements !== 'object') {
    throw new Error('Plugin hostRequirements is required for observability.');
  }

  const hostRequirements = plugin.hostRequirements;
  assertNonEmptyStringArray(hostRequirements.connectSrcOrigins, 'plugin.hostRequirements.connectSrcOrigins');
  assertNonEmptyStringArray(hostRequirements.frameSrcOrigins, 'plugin.hostRequirements.frameSrcOrigins');
  assertNonEmptyStringArray(hostRequirements.httpAllowlist, 'plugin.hostRequirements.httpAllowlist');

  if (!plugin.resolver || typeof plugin.resolver !== 'object') {
    throw new Error('Plugin resolver is required.');
  }

  if (plugin.resolver.kind !== 'inline-js') {
    throw new Error('Plugin resolver kind must be inline-js.');
  }

  if (typeof plugin.resolver.code !== 'string' || plugin.resolver.code.trim().length === 0) {
    throw new Error('Plugin resolver.code must be a non-empty string.');
  }
}

validateArtifact(animexPluginArtifact);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(animexPluginArtifact, null, 2), 'utf8');

console.log(`Plugin artifact written: ${outputPath}`);
