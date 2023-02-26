**Fixed-Interest NFT Lending**

    This project illustrates how Superfluid can be used as a sublayer powering financial applications. Here, we create a skeleton for a lending/borrowing protocol, where the user is able to put down an NFT as collateral and borrow DAI against it. 
    
    The borrow function creates a stream from the borrower to the contract to pay interest on your loan. The flow rate is determined from the APR defined in the contract and the loan amount (example - if you took out a 100 DAI loan and the APR is 10%, then a stream of 10 DAI/year would be created from the borrower to the NFT Lending contract).
    
    Additionally, if the user repays half of the loan, then the ```repay``` function updates the stream down. Finally, if the user fully repays, the payment stream is cancelled.
    
    Liquidations also happen if the user tries to "cheat", i.e. if he tries to cancel the stream by himself. Liquidation involves seizing the NFT and transferring that to a ```NFTChest``` owned by the NFT Lending contract, which serves as a safe place.

    

