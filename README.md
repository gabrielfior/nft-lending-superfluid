**Fixed-Interest NFT Lending**
    
    Create a smart contract that lets you put down an NFT as collateral and borrow stablecoins against it. 
    
    The borrow function pulls a stream from you using ACL to pay interest on your loan. So if you took out a 100 DAI loan and the APR is 10%, then a stream of 10 DAI/year would be started from your account to the NFT Lending contract.
    
    Say you repay half of your loan (so now just 50 DAI outstanding), then the repayment transaction would update your stream down to 5 DAI/year. And if you fully repay, your payment stream would be cancelled.
    
    If you cancel your stream to the NFT Lending contract, then no mercy! You’re liquidated.

