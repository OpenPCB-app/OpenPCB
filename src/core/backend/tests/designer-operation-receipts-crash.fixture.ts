import { openReceiptStore, receiptEnvelope, receiptIdentity } from "./designer-operation-receipts-harness";

const file = process.env.OPENPCB_RECEIPT_CRASH_DB;
const designId = process.env.OPENPCB_RECEIPT_CRASH_DESIGN;
if (!file || !designId) throw new Error("Missing receipt crash fixture parameters");
const store = await openReceiptStore(file, () => process.exit(73));
const envelope = receiptEnvelope(designId);
if (process.env.OPENPCB_RECEIPT_CRASH_CREATE === "1") {
  await store.createDesignOperation({ name: "Recovered design" }, {
    ...receiptIdentity(envelope), actionId: "create-unit", expectedRevision: null,
  });
}
await store.dispatchOperation(designId, envelope, receiptIdentity(envelope));
throw new Error("Crash hook did not run");
