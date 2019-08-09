import { Component, OnInit } from '@angular/core';

import { VaultService } from 'src/app/core/services/vault/vault.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  public didIds: string[] = [];

  constructor(private vaultService: VaultService) { }

  ngOnInit() {
    const didDocuments = this.vaultService.getAllDIDDocuments();
    this.didIds = Object.keys(didDocuments);
  }
}
