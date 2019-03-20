import * as base58 from 'bs58';
import * as elliptic from 'elliptic';
import * as encryptor from 'browser-passworder';
import * as nacl from 'tweetnacl/nacl-fast';
import { Buffer } from 'buffer/';
import { defer, Observable } from 'rxjs';
import { Injectable } from '@angular/core';

import { ImportKeyModel } from '../../models/ImportKeyModel';
import { ImportResultModel } from '../../models/ImportResultModel';
import { KeyPairModel } from '../../models/KeyPairModel';
import { SignatureType} from '../../enums/signature-type';
import { VaultService } from '../vault/vault.service';

@Injectable()
export class KeysService {

  constructor(private vaultService: VaultService) { }

  importFromJsonFile(file: string, filePassword: string, vaultPassword: string): Observable<ImportResultModel> {
    return defer(async() => {
      try {
        const decryptedFile = JSON.parse(await encryptor.decrypt(filePassword, file));
        const keyPairs: KeyPairModel[] = [];

        if (Array.isArray(decryptedFile) && decryptedFile.length > 0) {
          for (const keyModel of decryptedFile) {
            if (keyModel.alias && keyModel.type && keyModel.privateKey) {
              const importKeyModel = new ImportKeyModel(keyModel.alias, keyModel.type, keyModel.privateKey);
              const keyPairModel = this.getKeyPairModel(importKeyModel);
              keyPairs.push(keyPairModel);
            }
          }

          return await this.vaultService.importKeys(keyPairs, vaultPassword);
        } else {
          return new ImportResultModel(false, 'Invalid type of keystore');
        }
      } catch {
        return new ImportResultModel(false, 'Invalid file password or type of keystore');
      }
    });
  }

  importFromPrivateKey(alias: string, type: string, privateKey: string, vaultPassword: string): Observable<ImportResultModel> {
    return defer(async () => {
      try {
        const importKeyModel = new ImportKeyModel(alias, type, privateKey);
        const keyPairModel = this.getKeyPairModel(importKeyModel);
        const keyPairs = [keyPairModel];

        return await this.vaultService.importKeys(keyPairs, vaultPassword);
      } catch {
        return new ImportResultModel(false, 'Invalid private key');
      }
    });
  }

  private getKeyPairModel(importKeyModel: ImportKeyModel): KeyPairModel {
    if (importKeyModel.type === SignatureType.EdDSA) {
      const keyPair = nacl.sign.keyPair.fromSecretKey(base58.decode(importKeyModel.privateKey));
      const publicKey = base58.encode(Buffer.from(keyPair.publicKey));

      return new KeyPairModel(importKeyModel.alias, importKeyModel.type, publicKey, importKeyModel.privateKey);
    } else if (importKeyModel.type === SignatureType.ECDSA) {
      const ec = elliptic.ec('secp256k1');
      const key = ec.keyFromPrivate(base58.decode(importKeyModel.privateKey), 'hex');

      const compressedPubPoint = key.getPublic(true, 'hex');
      const publicKey = base58.encode(Buffer.from(compressedPubPoint, 'hex'));

      return new KeyPairModel(importKeyModel.alias, importKeyModel.type, publicKey, importKeyModel.privateKey);
    }
  }
}