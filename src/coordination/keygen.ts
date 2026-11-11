import { exportPrivateKey, generateSigningKeys, publicKeyString } from './canonical';

const keys = generateSigningKeys();
console.log(`STREAMLINE_SIGNING_KEY=${exportPrivateKey(keys.privateKey)}`);
console.log(`public key: ${publicKeyString(keys.publicKey)}`);
