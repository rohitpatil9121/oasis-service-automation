// Tally XML export — turns issued invoices into Sales vouchers that Tally Prime
// can swallow via Gateway of Tally → Import Data → Vouchers.
//
// Why a file and not a live connection: Tally almost always runs on a desktop in
// the office with no public address, so pushing to its HTTP gateway from a cloud
// server needs a tunnel that will be down more often than it is up. An XML the
// accountant imports is boring and it always works.
//
// Ledger names below MUST match the ledgers that exist in the Tally company, or
// Tally creates duplicates on import. They are configurable on company_profile
// so they can be aligned with whatever the accountant already uses.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Tally wants dates as YYYYMMDD, in IST.
const tallyDate = (iso) => {
  const ist = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}${String(ist.getUTCMonth() + 1).padStart(2, "0")}${String(ist.getUTCDate()).padStart(2, "0")}`;
};

// Tally signs ledger amounts: debit positive, credit negative.
const amt = (n) => Number(n || 0).toFixed(2);

function ledgerEntry(name, amount, isDeemedPositive) {
  return `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${isDeemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${amt(amount)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`;
}

function voucher(inv, cfg) {
  const date = tallyDate(inv.issued_at);
  const buyer = inv.buyer || {};
  const lines = inv.line_items || [];

  // Party is debited the full invoice value; sales + each tax head are credited.
  // Credits carry a negative sign, which is how Tally encodes them.
  const entries = [
    ledgerEntry(buyer.full_name || "Cash", inv.total, true),
    ledgerEntry(cfg.salesLedger, -inv.taxable_value, false),
  ];
  if (Number(inv.cgst) > 0) entries.push(ledgerEntry(cfg.cgstLedger, -inv.cgst, false));
  if (Number(inv.sgst) > 0) entries.push(ledgerEntry(cfg.sgstLedger, -inv.sgst, false));
  if (Number(inv.igst) > 0) entries.push(ledgerEntry(cfg.igstLedger, -inv.igst, false));
  if (Number(inv.round_off) !== 0)
    entries.push(ledgerEntry(cfg.roundOffLedger, -Number(inv.round_off), false));

  // The itemised breakup, so the invoice reads correctly inside Tally too.
  const inventory = lines.map((l) => `
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${esc(l.description)}</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <RATE>${amt(l.taxable / (Number(l.qty) || 1))}/Nos</RATE>
          <ACTUALQTY>${Number(l.qty) || 1} Nos</ACTUALQTY>
          <BILLEDQTY>${Number(l.qty) || 1} Nos</BILLEDQTY>
          <AMOUNT>${amt(-l.taxable)}</AMOUNT>
          ${l.hsn ? `<HSNCODE>${esc(l.hsn)}</HSNCODE>` : ""}
          <GSTOVRDNRATE>${Number(l.gstRate) || 0}</GSTOVRDNRATE>
          <ACCOUNTINGALLOCATIONS.LIST>
            <LEDGERNAME>${esc(cfg.salesLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${amt(-l.taxable)}</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>`).join("");

  return `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>${date}</DATE>
        <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(inv.invoice_no)}</VOUCHERNUMBER>
        <REFERENCE>${esc(inv.invoice_no)}</REFERENCE>
        <PARTYLEDGERNAME>${esc(buyer.full_name || "Cash")}</PARTYLEDGERNAME>
        <PARTYNAME>${esc(buyer.full_name || "Cash")}</PARTYNAME>
        <BASICBUYERNAME>${esc(buyer.full_name || "Cash")}</BASICBUYERNAME>
        <PLACEOFSUPPLY>${esc(inv.place_of_supply || "")}</PLACEOFSUPPLY>
        ${buyer.gstin ? `<PARTYGSTIN>${esc(buyer.gstin)}</PARTYGSTIN>` : ""}
        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
        <ISINVOICE>Yes</ISINVOICE>
        <BASICBASEPARTYNAME>${esc(buyer.full_name || "Cash")}</BASICBASEPARTYNAME>
        <ADDRESS.LIST TYPE="String">
          <ADDRESS>${esc(buyer.address || "")}</ADDRESS>
        </ADDRESS.LIST>
        ${entries.join("")}
        ${inventory}
      </VOUCHER>
    </TALLYMESSAGE>`;
}

/* Build the importable XML for a set of invoices.
   `company` is the company_profile row — companyName must match the Tally
   company exactly or the import is rejected. */
export function buildTallyXml(invoices, company = {}) {
  const cfg = {
    companyName: company.tally_company_name || company.legal_name || "",
    salesLedger: company.tally_sales_ledger || "Sales",
    cgstLedger: company.tally_cgst_ledger || "CGST",
    sgstLedger: company.tally_sgst_ledger || "SGST",
    igstLedger: company.tally_igst_ledger || "IGST",
    roundOffLedger: company.tally_roundoff_ledger || "Round Off",
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(cfg.companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${invoices.map((i) => voucher(i, cfg)).join("")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}
