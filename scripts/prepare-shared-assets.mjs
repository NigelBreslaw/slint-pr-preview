import { prepareSharedAssets } from './shared-assets.mjs';
const args = process.argv.slice(2);
if (!args.includes('--incoming') || !args.includes('--out')) throw new Error('Pass --incoming <artifact-directory> --out <site-directory>');
const option = name => args[args.indexOf(name) + 1];
const files = await prepareSharedAssets({
  incomingDirectory: option('--incoming'), outputDirectory: option('--out'), bootstrap: args.includes('--bootstrap'),
});
console.log(`Prepared ${files.length} immutable assets, including retained versions.`);
