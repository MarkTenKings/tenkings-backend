const input = () => ({ schemaVersion: 1, machineId: "00000000-0000-4000-8000-000000000001", stage: "SANDBOX",
  callbackOrigin: "https://vault.example.test", callbackHeaderName: "x-vault-spark-secret", profile: {
    apiBase: "https://nayax-spark-dmz.nayax.com/api", environment: "SANDBOX", sandboxConfirmed: true, preSelectionConfirmed: true, currency: "USD", currencyConfirmed: true,
    terminalId: "0434334921100366", terminalIdType: 1, nayaxMachineId: "71234996", hwSerial: "0434334921100366", siteId: 2,
    integratorId: "927", tokenId: 116383, signingProfile: "CURRENT_GUID_SHA256", wireApiVersion: null, vendorApprovalReference: "synthetic-fixture-confirmation", maxTotalCents: 100000,
    callbackTerminalIdRepresentation: "HW_SERIAL", acquiringOnlyConfirmed: true, cardUidPolicy: "REJECT_AMBIGUOUS", acquiringCardBrands: ["Visa"], unsupportedCardBrands: ["SMC"],
    triggerReplayPolicy: "DISABLED", cancelReplayPolicy: "DISABLED", maxTriggerAttempts: 1, maxCancelAttempts: 1,
  } });
module.exports = { input };
