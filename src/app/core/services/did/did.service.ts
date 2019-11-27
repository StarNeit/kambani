declare const Buffer;
import * as nacl from 'tweetnacl/nacl-fast';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Store, select } from '@ngrx/store';

import { AppState } from '../../store/app.state';
import { CreateDIDState } from '../../store/create-did/create-did.state';
import { DIDDocument } from '../../interfaces/did-document';
import { DidKeyEntryModel } from '../../interfaces/did-key-entry';
import { DidKeyModel } from '../../models/did-key.model';
import { EntryType } from '../../enums/entry-type';
import { environment } from 'src/environments/environment';
import { InitializeDIDUpdate } from '../../store/update-did/update-did.actions';
import { ManagementKeyEntryModel } from '../../interfaces/management-key-entry';
import { ManagementKeyModel } from '../../models/management-key.model';
import { RevokeModel } from '../../interfaces/revoke-model';
import { ServiceEntryModel } from '../../interfaces/service-entry';
import { ServiceModel } from '../../models/service.model';
import { SignatureType } from '../../enums/signature-type';
import { toHexString, calculateChainId } from '../../utils/helpers';
import { UpdateDIDModel } from '../../models/update-did.model';
import { UpdateDIDState } from '../../store/update-did/update-did.state';
import { UpdateEntryDocument } from '../../interfaces/update-entry-document';
import { VaultService } from '../vault/vault.service';

@Injectable()
export class DIDService {
  private createDIDState: CreateDIDState;
  private updateDIDState: UpdateDIDState;
  private id: string;
  private nonce: string;
  private VerificationKeySuffix = 'VerificationKey';
  private apiUrl = environment.apiUrl;
  private didMethodSpecVersion = environment.didMethodSpecVersion;
  private entrySchemaVersion = environment.entrySchemaVersion;

  constructor(
    private http: HttpClient,
    private store: Store<AppState>,
    private vaultService: VaultService) {
    this.store
      .pipe(select(state => state))
      .subscribe(state => {
        this.createDIDState = state.createDID;
        this.updateDIDState = state.updateDID;
      });
  }

  getId(): string {
    if (!this.id) {
      return this.generateId();
    }

    return this.id;
  }

  generateEntry(entryType: string): DIDDocument | UpdateEntryDocument {
    if (entryType === EntryType.UpdateDIDEntry) {
      return this.generateUpdateEntry();
    }

    return this.generateDocument();
  }

  recordCreateEntryOnChain(entry: DIDDocument): Observable<Object> {
    const entrySize = this.calculateEntrySize(
      [this.nonce],
      [EntryType.CreateDIDEntry, this.entrySchemaVersion],
      JSON.stringify(entry)
    );

    if (entrySize > environment.entrySizeLimit) {
      return of({error: true, message: 'You have exceeded the entry size limit! Please remove some of your keys or services.'});
    }

    const data = JSON.stringify([
      [EntryType.CreateDIDEntry, this.entrySchemaVersion, this.nonce],
      entry
    ]);

    return this.recordEntry(this.apiUrl, data);
  }

  recordUpdateEntryOnChain(entry: UpdateEntryDocument, managementKeyId: string, signature: string): Observable<Object> {
    const entrySize = this.calculateEntrySize(
      [],
      [EntryType.UpdateDIDEntry, this.entrySchemaVersion, managementKeyId, signature],
      JSON.stringify(entry)
    );

    if (entrySize > environment.entrySizeLimit) {
      return of({error: true, message: 'You have exceeded the entry size limit! Please remove some of your keys or services.'});
    }

    const data = JSON.stringify([
      [EntryType.UpdateDIDEntry, this.entrySchemaVersion, managementKeyId, signature],
      entry
    ]);

    // change the api url with update endpoint
    // const updateApiUrl = '';
    // return this.recordEntry(updateApiUrl, data);

    return of({data: ''});
  }

  loadDIDForUpdate(didId: string): void {
    this.id = didId;

    if (!this.updateDIDState.dids.find(d => d.didId === didId)) {
      const didDocument: DIDDocument = this.vaultService.getDIDPublicInfo(didId).didDocument;
      this.parseDocument(didDocument);
    }
  }

  revokeSigningKey(managementKeyId: string, updateEntry: UpdateEntryDocument): UpdateEntryDocument {
    let revokedManagementKeys: RevokeModel[] = [];
    if (updateEntry.revoke && updateEntry.revoke.managementKey) {
      revokedManagementKeys = updateEntry.revoke.managementKey;
    }

    if (!revokedManagementKeys.some(rm => rm.id === managementKeyId)) {
      revokedManagementKeys.push({ id: managementKeyId });

      let revokeObject = {};
      if (updateEntry.revoke) {
        revokeObject = updateEntry.revoke;
      }

      revokeObject['managementKey'] = revokedManagementKeys;
      updateEntry.revoke = revokeObject;
      return updateEntry;
    }

    return updateEntry;
  }

  clearData(): void {
    this.id = undefined;
    this.nonce = undefined;
  }

  private recordEntry(apiUrl: string, data: string) {
    const httpOptions = {
      headers: new HttpHeaders({
        'Content-Type': 'application/json'
      })
    };

    return this.http.post(apiUrl, data, httpOptions);
  }

  private generateDocument(): DIDDocument {
    const managementKeys = this.createDIDState.managementKeys.map(k => (this.buildManagementKeyEntryObject(k)));

    const didDocument: DIDDocument = {
      'didMethodVersion': this.didMethodSpecVersion,
      'managementKey': managementKeys
    };

    const didKeys = this.createDIDState.didKeys.map(k => (this.buildDidKeyEntryObject(k)));
    if (didKeys.length > 0) {
      didDocument.didKey = didKeys;
    }

    const services = this.createDIDState.services.map(s => (this.buildServiceEntryObject(s)));
    if (services.length > 0) {
      didDocument.service = services;
    }

    return didDocument;
  }

  private generateUpdateEntry(): UpdateEntryDocument {
    const didUpdateModel: UpdateDIDModel = this.updateDIDState.dids.find(d => d.didId === this.id);

    const newManagementKeys = this.getNew(new Set(didUpdateModel.originalManagementKeys), didUpdateModel.managementKeys);
    const newDidKeys = this.getNew(new Set(didUpdateModel.originalDidKeys), didUpdateModel.didKeys);
    const newServices = this.getNew(new Set(didUpdateModel.originalServices), didUpdateModel.services);
    const revokedManagementKeys = this.getRevoked(didUpdateModel.originalManagementKeys, new Set(didUpdateModel.managementKeys));
    const revokedDidKeys = this.getRevoked(didUpdateModel.originalDidKeys, new Set(didUpdateModel.didKeys));
    const revokedServices = this.getRevoked(didUpdateModel.originalServices, new Set(didUpdateModel.services));

    const updateEntry: UpdateEntryDocument = {};

    if (newManagementKeys.length > 0 || newDidKeys.length > 0 || newServices.length > 0) {
      updateEntry['add'] = this.constructAddObject(
        newManagementKeys as ManagementKeyModel[],
        newDidKeys as DidKeyModel[],
        newServices as ServiceModel[]
      );
    }

    if (revokedManagementKeys.length > 0 || revokedDidKeys.length > 0 || revokedServices.length > 0) {
      updateEntry['revoke'] = this.constructRevokeObject(revokedManagementKeys, revokedDidKeys, revokedServices);
    }

    return updateEntry;
  }

  private buildManagementKeyEntryObject(key: ManagementKeyModel): ManagementKeyEntryModel {
    let keyEntryObject = this.buildKeyEntryObject(key);
    keyEntryObject['priority'] = key.priority;

    if (key.priorityRequirement !== null) {
      keyEntryObject['priorityRequirement'] = key.priorityRequirement;
    }

    return keyEntryObject;
  }

  private buildDidKeyEntryObject(key: DidKeyModel): DidKeyEntryModel {
    let keyEntryObject = this.buildKeyEntryObject(key);
    keyEntryObject['purpose'] = key.purpose;

    if (key.priorityRequirement !== null) {
      keyEntryObject['priorityRequirement'] = key.priorityRequirement;
    }

    return keyEntryObject;
  }

  private buildKeyEntryObject(key: ManagementKeyModel | DidKeyModel): ManagementKeyEntryModel | DidKeyEntryModel {
    const publicKeyProperty = key.type == SignatureType.RSA ? 'publicKeyPem' : 'publicKeyBase58';

    const keyEntryObject = {
      id: `${this.id}#${key.alias}`,
      type: `${key.type}${this.VerificationKeySuffix}`,
      controller: key.controller,
      [publicKeyProperty]: key.publicKey
    };

    return keyEntryObject;
  }

  private buildServiceEntryObject(service: ServiceModel): ServiceEntryModel {
    let serviceEntryObject = {
      id: `${this.id}#${service.alias}`,
      type: service.type,
      serviceEndpoint: service.endpoint
    };

    if (service.priorityRequirement !== null) {
      serviceEntryObject['priorityRequirement'] = service.priorityRequirement;
    }

    return serviceEntryObject;
  }

  private getNew(original, current) {
    const _new = [];

    current.forEach(obj => {
      if (!original.has(obj)) {
        _new.push(obj);
      }
    });

    return _new;
  }

  private getRevoked(original, current): RevokeModel[] {
    const revoked: RevokeModel[] = [];

    original.forEach(obj => {
      if (!current.has(obj)) {
        revoked.push({ id: `${this.id}#${obj.alias}` });
      }
    });

    return revoked;
  }

  private constructAddObject(newManagementKeys: ManagementKeyModel[], newDidKeys: DidKeyModel[], newServices: ServiceModel[]): {} {
    const add = {};

    if (newManagementKeys.length > 0) {
      add['managementKey'] = newManagementKeys.map(k => (this.buildManagementKeyEntryObject(k)));
    }

    if (newDidKeys.length > 0) {
      add['didKey'] = newDidKeys.map(k => (this.buildDidKeyEntryObject(k)));
    }

    if (newServices.length > 0) {
      add['service'] = newServices.map(s => (this.buildServiceEntryObject(s)));
    }

    return add;
  }

  private constructRevokeObject(revokedManagementKeys: RevokeModel[], revokedDidKeys: RevokeModel[], revokedServices: RevokeModel[]): {} {
    const revoke = {};

    if (revokedManagementKeys.length > 0) {
      revoke['managementKey'] = revokedManagementKeys;
    }

    if (revokedDidKeys.length > 0) {
      revoke['didKey'] = revokedDidKeys;
    }

    if (revokedServices.length > 0) {
      revoke['service'] = revokedServices;
    }

    return revoke;
  }

  private generateId(): string {
    this.nonce = toHexString(nacl.randomBytes(32));

    const chainId = calculateChainId([EntryType.CreateDIDEntry, this.entrySchemaVersion, this.nonce]);
    this.id = `did:factom:${chainId}`;
    return this.id;
  }

  private calculateEntrySize(hexExtIds: string[], utf8ExtIds: string[], content: string): number {
    let totalEntrySize = 0;
    const fixedHeaderSize = 35;
    totalEntrySize += fixedHeaderSize + 2 * hexExtIds.length + 2 * utf8ExtIds.length;

    totalEntrySize += hexExtIds.reduce((accumulator, currentHexExtId) => {
      return accumulator + currentHexExtId.length / 2;
    }, 0);

    totalEntrySize += utf8ExtIds.reduce((accumulator, currentUtf8ExtId) => {
      return accumulator + this.getBinarySize(currentUtf8ExtId);
    }, 0);

    totalEntrySize += this.getBinarySize(content);

    return totalEntrySize;
  }

  private getBinarySize(string): number {
    return Buffer.byteLength(string, 'utf8');
  }

  private parseDocument(didDocument: DIDDocument): void {
    const managementKeys = this.extractManagementKeys(didDocument.managementKey);
    
    let didKeys = [];
    if (didDocument.didKey) {
      didKeys = this.extractDidKeys(didDocument.didKey);
    }

    let services = [];
    if (didDocument.service) {
      services = this.extractServices(didDocument.service);
    }

    const updateDIDModel = new UpdateDIDModel(this.id, managementKeys, didKeys, services);
    this.store.dispatch(new InitializeDIDUpdate(updateDIDModel));
  }

  private extractManagementKeys(documentManagementKeys: ManagementKeyEntryModel[]): ManagementKeyModel[] {
    return documentManagementKeys.map(k => new ManagementKeyModel(
      k.id.split('#')[1],
      k.priority,
      k.type.split(this.VerificationKeySuffix)[0],
      k.controller,
      k.publicKeyBase58 ? k.publicKeyBase58 : k.publicKeyPem,
      undefined,
      k.priorityRequirement
    ));
  }

  private extractDidKeys(documentDidKeys: DidKeyEntryModel[]): DidKeyModel[] {
    return documentDidKeys.map(k => new DidKeyModel(
      k.id.split('#')[1],
      k.purpose,
      k.type.split(this.VerificationKeySuffix)[0],
      k.controller,
      k.publicKeyBase58 ? k.publicKeyBase58 : k.publicKeyPem,
      undefined,
      k.priorityRequirement
    ));
  }

  private extractServices(documentServices: ServiceEntryModel[]): ServiceModel[] {
    return documentServices.map(s => new ServiceModel(
      s.type,
      s.serviceEndpoint,
      s.id.split('#')[1],
      s.priorityRequirement
    ));
  }
}
