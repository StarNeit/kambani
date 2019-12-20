declare const Buffer;
import { Component, OnInit } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { NgxSpinnerService } from 'ngx-spinner';
import { ToastrService } from 'ngx-toastr';
import { generateRandomFctAddress, generateRandomEcAddress } from 'factom';

import { ChromeMessageType } from 'src/app/core/enums/chrome-message-type';
import { DialogsService } from 'src/app/core/services/dialogs/dialogs.service';
import { FactomAddressType } from 'src/app/core/enums/factom-address-type';
import { ModalSizeTypes } from 'src/app/core/enums/modal-size-types';
import { PasswordDialogComponent } from '../../dialogs/password/password.dialog.component';
import { VaultService } from 'src/app/core/services/vault/vault.service';
import { PrivateAddressModalComponent } from '../../modals/private-address-modal/private-address-modal.component';

@Component({
  selector: 'app-manage-addresses',
  templateUrl: './manage-addresses.component.html',
  styleUrls: ['./manage-addresses.component.scss']
})
export class ManageAddressesComponent implements OnInit {
  public fctAddressesInfo = {};
  public ecAddressesInfo = {};
  public fctAddresses: string[] = [];
  public ecAddresses: string[] = [];
  public displayedFCTAddresses: string[] = [];
  public displayedECAddresses: string[] = [];
  public selectedAddressType: FactomAddressType = FactomAddressType.FCT;
  public FactomAddressType = FactomAddressType;
  public editAddressNickname: boolean[] = [];
  public pageSize: number = 6;
  public currentPage: number = 1;
  public currentStartIndex = 0;

  constructor(
    private dialogsService: DialogsService,
    private modalService: NgbModal,
    private spinner: NgxSpinnerService,
    private toastr: ToastrService,
    private vaultService: VaultService ) { }

  ngOnInit() {
    chrome.tabs && chrome.tabs.getCurrent(function(tab) {
      if (tab === undefined) {
        chrome.runtime.sendMessage({type: ChromeMessageType.ManageFactomAddressesRequest}, (response) => {
          if (response.success) {
            const popup_url = chrome.runtime.getURL('index.html');
            chrome.tabs.create({'url': popup_url});
          }
        });
      } else {
        chrome.runtime.sendMessage({type: ChromeMessageType.CheckRequests}, (response) => {
          if (response.manageFactomAddressesRequested) {
            chrome.runtime.sendMessage({type: ChromeMessageType.NewTabOpen});
          }
        });
      }
    });

    this.getAddressesInfo();
  }

  changeSelectedAddressType(addressType: FactomAddressType) {
    this.selectedAddressType = addressType;
    this.currentPage = 1;
    this.currentStartIndex = 0;
    this.displayedFCTAddresses = this.fctAddresses.slice(this.currentStartIndex, this.currentStartIndex + this.pageSize);
    this.displayedECAddresses = this.ecAddresses.slice(this.currentStartIndex, this.currentStartIndex + this.pageSize);
  }

  editNickname(publicAddress: string, type: FactomAddressType, nickname: string) {
    this.vaultService.updateFactomAddressNickname(publicAddress, type, nickname);

    if (type == FactomAddressType.FCT) {
      this.fctAddressesInfo[publicAddress] = nickname;
    } else {
      this.ecAddressesInfo[publicAddress] = nickname;
    }

    this.editAddressNickname[publicAddress] = false;
  }

  generateAddressPair() {
    const addressPair = this.selectedAddressType == FactomAddressType.FCT 
      ? generateRandomFctAddress()
      : generateRandomEcAddress();

    const dialogMessage = `Enter your vault password to import the generated ${this.selectedAddressType} address`;
    this.dialogsService.open(PasswordDialogComponent, ModalSizeTypes.ExtraExtraLarge, dialogMessage)
      .subscribe((vaultPassword: string) => {
        if (vaultPassword) {
          this.spinner.show();
          this.vaultService
            .importFactomAddress(
              this.selectedAddressType,
              addressPair.public,
              addressPair.private,
              vaultPassword)
            .subscribe(result => {
              this.spinner.hide();
              if (result.success) {
                this.toastr.success(result.message);
                this.getAddressesInfo();
              } else {
                this.toastr.error(result.message);
              }
            });
        }
      });
  }

  viewPrivateAddress(publicAddress: string) {
    const dialogMessage = 'Enter your vault password to view the secret key';
    this.dialogsService.open(PasswordDialogComponent, ModalSizeTypes.Medium, dialogMessage)
      .subscribe((vaultPassword: string) => {
        if (vaultPassword) {
          this.spinner.show();
          this.vaultService
            .getPrivateAddress(publicAddress, vaultPassword)
            .subscribe(result => {
              this.spinner.hide();
              if (result.success && result.message) {
                const confirmRef = this.modalService.open(PrivateAddressModalComponent);
                confirmRef.componentInstance.publicAddress = publicAddress;
                confirmRef.componentInstance.privateAddress = result.message;
                confirmRef.result
                  .then((result) => {})
                  .catch((error) => {});
              } else if (!result.success) {
                this.toastr.error(result.message);
              }
            });
        }
      });
  }

  removeAddress(publicAddress: string, type: FactomAddressType) {
    const dialogMessage = '<b>Warning! Any funds that you have in this address will be irrevocably lost, if you have not backed up your private key</b>. If you want to continue, enter your vault password to remove the FCT/EC address';
    this.dialogsService.open(PasswordDialogComponent, ModalSizeTypes.ExtraExtraLarge, dialogMessage)
      .subscribe((vaultPassword: string) => {
        if (vaultPassword) {
          this.spinner.show();
          this.vaultService
            .removeFactomAddress(publicAddress, type, vaultPassword)
            .subscribe(result => {
              this.spinner.hide();
              if (result.success) {
                this.toastr.success(result.message);
                this.getAddressesInfo();
              } else {
                this.toastr.error(result.message);
              }
            });
        }
      });
  }

  copyAddress(address: string, element) {
    const selBox = document.createElement('textarea');
    selBox.style.position = 'fixed';
    selBox.style.left = '0';
    selBox.style.top = '0';
    selBox.style.opacity = '0';
    selBox.value = address;
    document.body.appendChild(selBox);
    selBox.focus();
    selBox.select();
    document.execCommand('copy');
    document.body.removeChild(selBox);

    element.classList.add('clicked');
    setTimeout(() => {element.classList.remove('clicked')},2000);
  }

  changePage (page) {
    this.currentPage = page;
    this.currentStartIndex = (this.currentPage - 1) * this.pageSize;

    if (this.selectedAddressType == FactomAddressType.FCT) {
      this.displayedFCTAddresses = this.fctAddresses.slice(this.currentStartIndex, this.currentStartIndex + this.pageSize);
    } else {
      this.displayedECAddresses = this.ecAddresses.slice(this.currentStartIndex, this.currentStartIndex + this.pageSize);
    }
  }

  private getAddressesInfo() {
    this.fctAddressesInfo = this.vaultService.getFCTAddressesPublicInfo();
    this.ecAddressesInfo = this.vaultService.getECAddressesPublicInfo();

    this.fctAddresses = Object.keys(this.fctAddressesInfo);
    this.ecAddresses = Object.keys(this.ecAddressesInfo);

    this.displayedFCTAddresses = this.fctAddresses.slice(this.currentStartIndex, this.currentStartIndex + this.pageSize);
    this.displayedECAddresses = this.ecAddresses.slice(this.currentStartIndex, this.currentStartIndex + this.pageSize);
  }
}
