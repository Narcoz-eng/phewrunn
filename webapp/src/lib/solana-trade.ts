import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

async function loadAddressLookupTablesForTransaction(
  connection: Connection,
  transaction: VersionedTransaction
): Promise<AddressLookupTableAccount[]> {
  if (!("addressTableLookups" in transaction.message)) {
    return [];
  }

  const addressTableLookups = transaction.message.addressTableLookups ?? [];
  if (addressTableLookups.length === 0) {
    return [];
  }

  const lookupTableResponses = await Promise.all(
    addressTableLookups.map((lookup) => connection.getAddressLookupTable(lookup.accountKey))
  );

  return lookupTableResponses
    .map((response) => response.value)
    .filter((table): table is AddressLookupTableAccount => table !== null);
}

export async function appendTradeVerificationMemoToTransaction(
  connection: Connection,
  transaction: VersionedTransaction,
  memo: string
): Promise<VersionedTransaction> {
  const addressLookupTableAccounts = await loadAddressLookupTablesForTransaction(
    connection,
    transaction
  );
  const decompiledMessage = TransactionMessage.decompile(
    transaction.message,
    addressLookupTableAccounts.length > 0
      ? { addressLookupTableAccounts }
      : undefined
  );

  decompiledMessage.instructions.push(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: new TextEncoder().encode(memo),
    })
  );

  const compiledMessage =
    "addressTableLookups" in transaction.message
      ? decompiledMessage.compileToV0Message(addressLookupTableAccounts)
      : decompiledMessage.compileToLegacyMessage();

  return new VersionedTransaction(compiledMessage);
}
