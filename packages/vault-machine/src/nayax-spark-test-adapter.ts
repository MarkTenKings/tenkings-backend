import { randomUUID } from "node:crypto";
import type { PaymentAdapter, PaymentCapabilities, PaymentSessionRequest, PaymentSessionResult, PaymentVoidRequest, PaymentVoidResult, PaymentEvidenceNotice, PaymentRecoverySnapshot, PaymentVoidRetirement, PaymentProviderRecoveryEvidence } from "../../vault-contracts/dist";
import { NayaxSparkClient, SPARK_GUID, runSparkEffectGuard, sparkTriggerBody, sparkVoidBody, type NayaxSparkClientOptions } from "./nayax-spark-client";
import { NayaxSparkJournal, type SparkJournalSession } from "./nayax-spark-journal";
import { digest } from "./util";
import { PaymentNoEffectError, VaultError } from "./types";
export interface NayaxSparkObservation {
    receiptId: string;
    stage?: "SANDBOX" | "PRODUCTION";
    paymentBindingDigest?: string;
    kind: "TRANSACTION" | "DECLINE" | "TIMEOUT";
    sparkTransactionId: string;
    nayaxTransactionId: string | null;
    machineId: string;
    terminalId: string | null;
    hwSerial: string;
    siteId: number | null;
    amountCents: number | null;
    currency: string | null;
    currencySource: "CALLBACK" | "MACHINE_BINDING" | null;
    verdict: string | null;
    errorCode: number | null;
    machineAuTime: string | null;
    methodClassification: "ACQUIRING" | "AMBIGUOUS" | "UNSUPPORTED";
    methodProfileDigest: string;
    methodEvidence: {
        cardUidPresent: boolean;
        cardBrandClass: "SUPPORTED_ACQUIRING" | "UNSUPPORTED" | "ABSENT" | "UNKNOWN";
        authCodePresent: boolean;
        rrnPresent: boolean;
    };
}
export interface SparkReceiptFeed {
    observations: NayaxSparkObservation[];
    nextCursor: string;
    hasMore: boolean;
}
export interface NayaxSparkTestOptions extends NayaxSparkClientOptions {
    machineId: string;
    terminalId: string;
    terminalIdType: 1 | 2;
    nayaxMachineId: string;
    hwSerial: string;
    siteId: number;
    currency: "USD";
    currencyConfirmed: true;
    journalPath: string;
    maxTotalCents: number;
    acquiringOnlyConfirmed: true;
    cardUidPolicy: "REJECT_AMBIGUOUS" | "ALLOW_CONFIRMED_ACQUIRING";
    acquiringCardBrands: string[];
    unsupportedCardBrands: string[];
    callbackTerminalIdRepresentation: "HW_SERIAL" | "MACHINE_ID";
    triggerReplayPolicy: "DISABLED" | "SAME_GUID_CONFIRMED_FINAL";
    cancelReplayPolicy: "DISABLED" | "SAME_REQUEST_CONFIRMED";
    maxTriggerAttempts: number;
    maxCancelAttempts: number;
    readObservations: (id: string) => Promise<NayaxSparkObservation[]>;
    readReceiptFeed?: (after: string) => Promise<SparkReceiptFeed>;
    /** Deterministic test clock; production always uses the system UTC clock. */
    now?: () => number;
}
interface Capture {
    providerTransactionId: string;
    receiptId: string;
    amountCents: number;
    currency: "USD";
    currencySource: string;
    machineAuTime: string;
    bindingDigest: string;
}
export class NayaxSparkPreflightError extends PaymentNoEffectError {
}
/** Only the vendor-provisioned Remote Start PRE_SELECTION acquiring flow can capture. */
export class NayaxSparkTestAdapter implements PaymentAdapter {
    private readonly client: NayaxSparkClient;
    private readonly journal: NayaxSparkJournal;
    readonly bindingDigest: string;
    private queue: Promise<unknown> = Promise.resolve();
    private lastFeedPoll = 0;
    private feedFresh = false;
    private readonly methodProfileDigest: string;
    constructor(private readonly options: NayaxSparkTestOptions) {
        if (!SPARK_GUID.test(options.machineId) || !decimalId(options.nayaxMachineId) || !validTerminal(options.terminalId) || !validTerminal(options.hwSerial)
            || ![1, 2].includes(options.terminalIdType) || options.terminalId !== (options.terminalIdType === 1 ? options.hwSerial : options.nayaxMachineId)
            || !Number.isSafeInteger(options.siteId) || options.siteId < 1 || options.siteId > 32767 || options.currency !== "USD" || options.currencyConfirmed !== true
            || !Number.isSafeInteger(options.maxTotalCents) || options.maxTotalCents < 1 || options.maxTotalCents > 99999999 || options.acquiringOnlyConfirmed !== true
            || !["REJECT_AMBIGUOUS", "ALLOW_CONFIRMED_ACQUIRING"].includes(options.cardUidPolicy)
            || !["HW_SERIAL", "MACHINE_ID"].includes(options.callbackTerminalIdRepresentation)
            || !["DISABLED", "SAME_GUID_CONFIRMED_FINAL"].includes(options.triggerReplayPolicy) || !["DISABLED", "SAME_REQUEST_CONFIRMED"].includes(options.cancelReplayPolicy)
            || ![options.maxTriggerAttempts, options.maxCancelAttempts].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 3)
            || !validBrands(options.acquiringCardBrands) || !validBrands(options.unsupportedCardBrands) || options.acquiringCardBrands.some(v => options.unsupportedCardBrands.includes(v))
            || typeof options.readObservations !== "function" || (!options.fetchImpl && typeof options.readReceiptFeed !== "function") || options.now && !options.fetchImpl)
            throw new VaultError("SPARK_MACHINE_CONFIG_INVALID", "Spark vendor-confirmed profile is incomplete", 503);
        this.options = { ...options, acquiringCardBrands: [...options.acquiringCardBrands], unsupportedCardBrands: [...options.unsupportedCardBrands] };
        Object.freeze(this.options.acquiringCardBrands); Object.freeze(this.options.unsupportedCardBrands); Object.freeze(this.options);
        this.client = new NayaxSparkClient(this.options);
        this.methodProfileDigest = digest({ acquiringCardBrands: options.acquiringCardBrands, acquiringOnlyConfirmed: true,
            callbackTerminalIdRepresentation: options.callbackTerminalIdRepresentation, cardUidPolicy: options.cardUidPolicy, unsupportedCardBrands: options.unsupportedCardBrands });
        this.bindingDigest = digest({ provider: "NAYAX_SPARK", mode: options.environment === "PRODUCTION" ? "LIVE" : "OFFICIAL_TEST", ...(options.environment === "PRODUCTION" ? { credentialGeneration: options.credentialGeneration } : {}), flow: "REMOTE_START_PRE_SELECTION", apiBase: this.client.apiBase,
            machineId: options.machineId, terminalId: options.terminalId, terminalIdType: options.terminalIdType, nayaxMachineId: options.nayaxMachineId, hwSerial: options.hwSerial,
            siteId: options.siteId, integratorId: options.integratorId, tokenId: options.tokenId, currency: options.currency, signingProfile: options.signingProfile, wireApiVersion: options.wireApiVersion,
            vendorApprovalReference: options.vendorApprovalReference, maxTotalCents: options.maxTotalCents, acquiringOnlyConfirmed: options.acquiringOnlyConfirmed,
            cardUidPolicy: options.cardUidPolicy, acquiringCardBrands: options.acquiringCardBrands, unsupportedCardBrands: options.unsupportedCardBrands,
            callbackTerminalIdRepresentation: options.callbackTerminalIdRepresentation, triggerReplayPolicy: options.triggerReplayPolicy, cancelReplayPolicy: options.cancelReplayPolicy,
            maxTriggerAttempts: options.maxTriggerAttempts, maxCancelAttempts: options.maxCancelAttempts });
        this.journal = new NayaxSparkJournal(options.journalPath, this.bindingDigest, Boolean(options.fetchImpl));
    }
    async capabilities(): Promise<PaymentCapabilities> {
        return { adapterName: this.options.environment === "PRODUCTION" ? "nayax-spark-remote-start-preselection" : "nayax-spark-remote-start-preselection-test", adapterVersion: "0.2.0", apiVersion: this.options.wireApiVersion,
            mode: this.options.environment === "PRODUCTION" ? "LIVE" : "OFFICIAL_TEST", provider: "NAYAX_SPARK", bindingDigest: this.bindingDigest, captureBeforeFulfillment: true, flow: "REMOTE_START_PRE_SELECTION",
            acquiringOnlyConfirmed: true, preSelectionConfirmed: true, ...(this.options.environment === "PRODUCTION" ? { productionConfirmed: true as const } : { sandboxConfirmed: true as const }), maxItems: 25, maxTotalCents: this.options.maxTotalCents, cancellationBeforeAuthorization: false, ready: true };
    }
    startSession(request: PaymentSessionRequest): Promise<PaymentSessionResult> {
        return this.serial(async () => {
            if (!request || !SPARK_GUID.test(request.saleId) || typeof request.idempotencyKey !== "string" || request.idempotencyKey.length < 1 || request.idempotencyKey.length > 160
                || request.mode !== (this.options.environment === "PRODUCTION" ? "PRODUCTION" : "CERTIFICATION") || request.currency !== "USD" || !Number.isSafeInteger(request.totalCents) || request.totalCents < 1 || request.totalCents > this.options.maxTotalCents
                || !Array.isArray(request.items) || request.items.length < 1 || request.items.length > 25 || request.items.some(i => !i || typeof i.lineId !== "string" || !i.lineId || typeof i.name !== "string" || !i.name || !Number.isSafeInteger(i.priceCents) || i.priceCents < 1)
                || new Set(request.items.map(i => i.lineId)).size !== request.items.length || request.items.reduce((sum, i) => sum + i.priceCents, 0) > request.totalCents)
                throw new NayaxSparkPreflightError("SPARK_TEST_REQUEST_INVALID", "Spark purchase is invalid", 400);
            if (!this.journal.byRequest(request.idempotencyKey)) runSparkEffectGuard(this.options.beforeEffect);
            const id = randomUUID();
            const entry = this.journal.begin({ spark_id: id, request_key: request.idempotencyKey, sale_id: request.saleId, request_digest: digest(request), total_cents: request.totalCents, currency: request.currency,
                auth_sent_at: this.now(), trigger_body: sparkTriggerBody(id, this.options.terminalId, this.options.terminalIdType, request.totalCents, `Header:Ten Kings;Packs:${request.items.length};Total:USD ${(request.totalCents / 100).toFixed(2)}`) });
            if (!entry.created)
                return this.reconcileInternal(entry.session.spark_id, true);
            try {
                const response = await this.client.authenticate(id, this.options.terminalId, this.options.terminalIdType, new Date(this.now()));
                if (response.verdict === "Declined") {
                    this.journal.negative(id, `AUTH_DECLINED_${response.errorCode ?? "UNSPECIFIED"}`);
                    return this.result(this.session(id), "DECLINED");
                }
                this.journal.authApproved(id, this.now());
                await this.sendTrigger(this.session(id));
            }
            catch {
                if (this.session(id).trigger_count === 0)
                    this.journal.negative(id, "AUTH_NOT_TRIGGERED");
            }
            return this.reconcileInternal(id, false);
        });
    }
    reconcile(id: string, options?: {allowReplay:boolean}): Promise<PaymentSessionResult> { return this.serial(() => this.reconcileInternal(id, options?.allowReplay ?? true)); }
    reconcileRequest(key: string, options?: {allowReplay:boolean}): Promise<PaymentSessionResult | null> { return this.serial(async () => { const s = this.journal.byRequest(key); if (!s)
        throw new VaultError("SPARK_UNBOUND_START_REQUIRES_REVIEW", "Spark start has no durable binding", 503); return this.reconcileInternal(s.spark_id, options?.allowReplay ?? true); }); }
    cancelSession(id: string, key: string): Promise<PaymentSessionResult> { return this.serial(async () => { if (!key || key.length > 160)
        throw this.proofError(); const result = await this.reconcileInternal(id, false); return result.state === "SETTLED" || result.state === "DECLINED" ? result : { ...result, state: "UNKNOWN" }; }); }
    private async sendTrigger(s: SparkJournalSession): Promise<void> {
        runSparkEffectGuard(this.options.beforeEffect);
        this.journal.triggerIntent(s.spark_id, this.now());
        try {
            const response = await this.client.trigger(s.spark_id, s.trigger_body);
            this.journal.triggerOutcome(s.spark_id, response.verdict, response.errorCode);
            if (response.verdict === "Approved")
                this.journal.triggerAck(s.spark_id);
            else if (response.errorCode != null && [20, 21, 22, 23, 25, 29, 34].includes(response.errorCode))
                this.journal.negative(s.spark_id, `TRIGGER_DECLINED_${response.errorCode}`);
        }
        catch { /* A persisted attempt may have reached Nayax. Its exact body is retained. */ }
    }
    private async reconcileInternal(id: string, allowReplay: boolean): Promise<PaymentSessionResult> {
        let s = this.session(id);
        if (s.phase === "AUTH_INTENT" && s.trigger_count === 0)
            this.journal.negative(id, "AUTH_NOT_TRIGGERED");
        let readSucceeded = false;
        try {
            const rows = await this.options.readObservations(id);
            if (!Array.isArray(rows) || rows.length > 1000)
                throw this.proofError();
            for (const row of rows) {
                this.validateShape(row);
                if (row.sparkTransactionId !== id)
                    throw this.proofError();
            }
            this.journal.ingest(rows);
            readSucceeded = true;
        }
        catch (error) {
            if (error instanceof VaultError || protocolSourceError(error))
                throw error;
        }
        this.evaluate(id);
        s = this.session(id);
        if (s.exception_code)
            return this.result(s, "UNKNOWN");
        if (s.capture)
            return this.captured(s);
        if (s.negative_code)
            return this.result(s, "DECLINED");
        const now = this.now();
        if (allowReplay && readSucceeded && this.options.triggerReplayPolicy === "SAME_GUID_CONFIRMED_FINAL" && s.trigger_count > 0 && s.trigger_count < this.options.maxTriggerAttempts
            && s.last_trigger_at != null && now >= s.last_trigger_at + 60000 && s.expires_at != null && now < s.expires_at) {
            await this.sendTrigger(s);
            return this.reconcileInternal(id, false);
        }
        return this.result(s, readSucceeded && s.phase === "TRIGGER_ACK" ? "REQUESTED" : "UNKNOWN");
    }
    /** Reduce all durable facts, never last-arrival order. Conflicts remain latched. */
    private evaluate(id: string): void {
        const s = this.session(id);
        const rows = this.journal.observations(id) as NayaxSparkObservation[];
        for (const row of rows) {
            try {
                this.validateBinding(row, s);
            }
            catch {
                this.anomaly(s, "SPARK_OBSERVATION_BINDING_INVALID", row);
                return;
            }
        }
        if (rows.some(r => r.kind === "TIMEOUT")) {
            this.anomaly(s, "SPARK_PRESELECTION_TIMEOUT_MISMATCH");
            return;
        }
        const approved = rows.filter(r => r.kind === "TRANSACTION" && r.verdict === "Approved");
        const negative = rows.filter(r => r.verdict === "Declined");
        if (approved.length) {
            const complete = approved.filter(r => r.nayaxTransactionId && r.terminalId === this.callbackTerminal() && r.siteId === this.options.siteId && r.amountCents === s.total_cents && r.currency === "USD"
                && ["CALLBACK", "MACHINE_BINDING"].includes(r.currencySource ?? "") && validMachineTime(r.machineAuTime) && r.methodClassification === "ACQUIRING");
            if (approved.some(r => r.methodClassification !== "ACQUIRING")) {
                this.anomaly(s, "SPARK_PAYMENT_METHOD_UNVERIFIED", approved[0]);
                return;
            }
            if (complete.length !== approved.length) {
                this.anomaly(s, "SPARK_CAPTURE_FIELDS_INCOMPLETE", approved[0]);
                return;
            }
            const identities = new Set(complete.map(r => `${r.nayaxTransactionId}:${r.machineAuTime}`));
            if (identities.size !== 1) {
                this.anomaly(s, "SPARK_CONFLICTING_CAPTURE", complete[0]);
                return;
            }
            const row = complete[0]!;
            const proof: Capture = { providerTransactionId: row.nayaxTransactionId!, receiptId: row.receiptId, amountCents: row.amountCents!, currency: "USD", currencySource: row.currencySource!, machineAuTime: row.machineAuTime!, bindingDigest: this.bindingDigest };
            if (s.capture) {
                const prior = this.captureProof(s);
                if (prior.providerTransactionId !== proof.providerTransactionId || prior.machineAuTime !== proof.machineAuTime) {
                    this.anomaly(s, "SPARK_CONFLICTING_CAPTURE", row);
                    return;
                }
            }
            else if (s.trigger_count < 1) {
                this.anomaly(s, "SPARK_UNTRIGGERED_CAPTURE", row);
                return;
            }
            else
                this.journal.capture(id, JSON.stringify(proof));
            if (s.negative_code || negative.length)
                this.anomaly(this.session(id), "SPARK_APPROVAL_NEGATIVE_CONFLICT", row);
            else if (s.exception_code)
                this.anomaly(this.session(id), s.exception_code, row);
            return;
        }
        // DeclineCallback terminates the triggered attempt without authorization
        // (Spark manual 5.3.8). Its documented body contains no payment-method
        // proof. Keep the exact binding checks above, and require acquisition
        // evidence for TransactionCallback receipts rather than inventing it
        // for a session-level decline. Supported final codes remain bounded below.
        const unverifiedTransaction = negative.find(r => r.kind === "TRANSACTION" && r.methodClassification !== "ACQUIRING");
        if (unverifiedTransaction) {
            this.anomaly(s, "SPARK_PAYMENT_METHOD_UNVERIFIED", unverifiedTransaction);
            return;
        }
        const hasFinal = negative.some(r => r.kind === "DECLINE" && [38, 44, 45].includes(r.errorCode ?? -1) || r.kind === "TRANSACTION" && [35, 37].includes(r.errorCode ?? -1));
        if (hasFinal && (s.trigger_count === 1 || this.options.triggerReplayPolicy === "SAME_GUID_CONFIRMED_FINAL"))
            this.journal.negative(id, "CALLBACK_DECLINED");
    }
    private validateShape(row: NayaxSparkObservation): void {
        if (!row || typeof row.receiptId !== "string" || !this.receiptMatchesStage(row.receiptId)
            || this.options.environment === "PRODUCTION" && (row.stage !== "PRODUCTION" || row.paymentBindingDigest !== this.bindingDigest)
            || this.options.environment === "SANDBOX" && row.stage != null && row.stage !== "SANDBOX" || !SPARK_GUID.test(row.sparkTransactionId) || !["TRANSACTION", "DECLINE", "TIMEOUT"].includes(row.kind))
            throw this.proofError();
    }
    private validateBinding(r: NayaxSparkObservation, s: SparkJournalSession): void {
        this.validateShape(r);
        if (r.methodProfileDigest !== this.methodProfileDigest || r.sparkTransactionId !== s.spark_id || r.machineId !== this.options.nayaxMachineId || r.hwSerial !== this.options.hwSerial
            || r.terminalId != null && r.terminalId !== this.callbackTerminal() || r.siteId != null && r.siteId !== this.options.siteId || r.currency != null && r.currency !== "USD"
            || r.nayaxTransactionId != null && !decimalId(r.nayaxTransactionId) || r.amountCents != null && (!Number.isSafeInteger(r.amountCents) || r.amountCents !== s.total_cents)
            || r.machineAuTime != null && !validMachineTime(r.machineAuTime) || r.errorCode != null && !Number.isSafeInteger(r.errorCode)
            || r.verdict === "Approved" && r.errorCode != null && r.errorCode !== 0 || r.kind === "TRANSACTION" && !["Approved", "Declined"].includes(r.verdict ?? "")
            || r.kind === "DECLINE" && r.verdict !== "Declined")
            throw this.proofError();
        if (r.kind === "TRANSACTION" && r.verdict === "Declined"
            && (!r.nayaxTransactionId || r.terminalId !== this.callbackTerminal() || r.siteId !== this.options.siteId || !validMachineTime(r.machineAuTime))) throw this.proofError();
        if (r.kind === "TRANSACTION" && r.verdict === "Approved") {
            const e = r.methodEvidence;
            if (!e || !["SUPPORTED_ACQUIRING", "UNSUPPORTED", "ABSENT", "UNKNOWN"].includes(e.cardBrandClass) || ![e.cardUidPresent, e.authCodePresent, e.rrnPresent].every(v => typeof v === "boolean")
                || r.methodClassification === "ACQUIRING" && (e.cardBrandClass === "UNSUPPORTED" || e.cardBrandClass === "UNKNOWN" || e.cardUidPresent && this.options.cardUidPolicy !== "ALLOW_CONFIRMED_ACQUIRING"))
                throw this.proofError();
        }
    }
    async voidPaidTransaction(request: PaymentVoidRequest, options?: { beforeTransport: () => void }): Promise<PaymentVoidResult> {
        return this.serial(async () => {
            const s = this.session(request.providerSessionId);
            const proof = this.captureProof(s);
            if (!SPARK_GUID.test(request.actionId) || request.saleId !== s.sale_id || request.bindingDigest !== this.bindingDigest || request.providerTransactionId !== proof.providerTransactionId
                || request.amountCents !== s.total_cents || request.currency !== "USD" || typeof request.reason !== "string" || request.reason.trim().length < 8 || request.reason.length > 500 || /[\x00-\x1f\x7f]/.test(request.reason))
                throw this.proofError();
            // A retained main-ledger approval cannot recreate lost provider history.
            this.journal.assertVoidRecoveryAllowed(request.actionId);
            const body = sparkVoidBody({ sparkId: s.spark_id, nayaxId: proof.providerTransactionId, siteId: this.options.siteId, machineAuTime: proof.machineAuTime, terminalId: this.options.terminalId, terminalIdType: this.options.terminalIdType, cents: s.total_cents, reason: request.reason });
            const entry = this.journal.beginVoid({ action_id: request.actionId, spark_id: s.spark_id, sale_id: s.sale_id, request_digest: digest(request), request_json: JSON.stringify(request), body });
            let intent = entry.intent;
            const prior = intent.result_json ? JSON.parse(intent.result_json) as PaymentVoidResult : null;
            if (prior && prior.state !== "UNKNOWN")
                return prior;
            const now = this.now();
            const canRetry = this.options.cancelReplayPolicy === "SAME_REQUEST_CONFIRMED" && intent.attempt_count < this.options.maxCancelAttempts
                && intent.last_attempt_at != null && now >= intent.last_attempt_at + 60000 && now <= intent.last_attempt_at + 24 * 60 * 60000;
            if (!entry.created && intent.attempt_count > 0 && !canRetry)
                return prior ?? this.voidResult(request, "UNKNOWN");
            // Recheck main-machine authority after waiting in the adapter queue,
            // immediately before recording a transport attempt and sending bytes.
            runSparkEffectGuard(this.options.beforeEffect);
            options?.beforeTransport();
            this.journal.voidAttempt(request.actionId, now);
            let result = this.voidResult(request, "UNKNOWN");
            try {
                const response = await this.client.void(s.spark_id, intent.body);
                if (response.verdict === "Approved")
                    result = this.voidResult(request, "VOIDED");
                else if (response.errorCode != null && [27, 31, 32, 36].includes(response.errorCode))
                    result = this.voidResult(request, "DECLINED", response.errorCode);
                // Already Cancelled (28) is not proof of the amount or cancellation type of this intent.
                else
                    result = this.voidResult(request, "UNKNOWN", response.errorCode ?? undefined);
            }
            catch { /* Keep the original intent and exact body for explicit, bounded replay. */ }
            this.journal.voidResult(request.actionId, result);
            return result;
        });
    }
    private voidResult(r: PaymentVoidRequest, state: PaymentVoidResult["state"], errorCode?: number): PaymentVoidResult {
        return { actionId: r.actionId, state, providerSessionId: r.providerSessionId, providerTransactionId: r.providerTransactionId, amountCents: r.amountCents, currency: r.currency,
            evidenceReference: `sha256:${digest({ actionId: r.actionId, requestDigest: digest(r), state, errorCode: errorCode ?? null })}`, ...(errorCode == null ? {} : { errorCode }) };
    }
    pollEvidence(): Promise<readonly PaymentEvidenceNotice[]> { return this.serial(() => this.pollInternal()); }
    private async pollInternal(force = false): Promise<readonly PaymentEvidenceNotice[]> {
        const now = this.now();
        if (this.options.readReceiptFeed && (force || now < this.lastFeedPoll || now >= this.lastFeedPoll + 5000)) {
            this.lastFeedPoll = now;
            this.feedFresh = false;
            for (let page = 0; page < 10; page++) {
                const after = this.journal.cursor();
                let feed: SparkReceiptFeed;
                try {
                    feed = await this.options.readReceiptFeed(after);
                }
                catch (error) {
                    if (protocolSourceError(error)) throw error;
                    break;
                }
                if (!feed || !Array.isArray(feed.observations) || feed.observations.length > 100 || typeof feed.hasMore !== "boolean" || !/^(0|[1-9][0-9]{0,18})$/.test(feed.nextCursor)
                    || BigInt(feed.nextCursor)>9223372036854775807n || BigInt(feed.nextCursor) < BigInt(after)
                    || feed.observations.length>0 && feed.nextCursor===after || feed.observations.length===0 && (feed.nextCursor!==after || feed.hasMore))
                    throw this.proofError();
                for (const row of feed.observations)
                    this.validateShape(row);
                this.journal.ingest(feed.observations, feed.nextCursor);
                if (!feed.hasMore) {
                    this.feedFresh = true;
                    break;
                }
                if (page === 9)
                    this.anomaly(null, "SPARK_RECEIPT_FEED_BACKLOG");
            }
        }
        for (const id of this.journal.receiptSessions()) {
            const s = this.journal.bySession(id);
            if (!s)
                this.anomaly(null, "SPARK_ORPHAN_RECEIPT", (this.journal.observations(id) as NayaxSparkObservation[])[0]);
            else
                this.evaluate(id);
        }
        return this.journal.notices();
    }
    acknowledgeEvidence(id: string): Promise<void> { return this.serial(async () => { this.journal.acknowledge(id); }); }
    financialRecoveryEvidence(): Promise<PaymentProviderRecoveryEvidence> {
        return this.serial(async () => {
            await this.pollInternal(true);
            const evidence = this.journal.financialRecoveryEvidence();
            return { bindingDigest: this.bindingDigest, evidenceDigest: evidence.evidenceDigest,
                blockers: [...evidence.blockers, ...(!this.feedFresh ? ["SPARK_RECEIPT_FEED_UNAVAILABLE"] : [])] };
        });
    }
    retireVoidAction(actionId: string, actionDigest: string, reason: PaymentVoidRetirement["reason"]): Promise<PaymentVoidRetirement> {
        return this.serial(async () => {
            if (!SPARK_GUID.test(actionId) || !/^[a-f0-9]{64}$/.test(actionDigest) || !["EXPIRED_UNSTARTED", "EXTERNAL_REVIEW"].includes(reason)) throw this.proofError();
            return this.journal.retireVoidAction(actionId, actionDigest, reason);
        });
    }
    auditRecovery(snapshot: PaymentRecoverySnapshot): Promise<readonly PaymentEvidenceNotice[]> {
        return this.serial(async () => {
            await this.pollInternal(true);
            const sessions = this.journal.sessions();
            for (const s of sessions) {
                const main = snapshot.sales.find(r => r.saleId === s.sale_id);
                if (!main) {
                    this.anomaly(s, "SPARK_ORPHAN_JOURNAL_SESSION");
                    continue;
                }
                if (main.bindingDigest !== this.bindingDigest || main.requestKey !== s.request_key || main.requestDigest != null && main.requestDigest !== s.request_digest
                    || main.providerSessionId != null && main.providerSessionId !== s.spark_id || main.totalCents !== s.total_cents || main.currency !== s.currency)
                    this.anomaly(s, "SPARK_MAIN_JOURNAL_BINDING_MISMATCH");
                if ((main.paymentState === "SETTLED" || main.hasCommittedFulfillment) && !s.capture)
                    this.anomaly(s, "SPARK_MAIN_CAPTURE_MISSING");
                if (s.capture) {
                    const proof = this.captureProof(s);
                    if (main.providerTransactionId != null && main.providerTransactionId !== proof.providerTransactionId)
                        this.anomaly(s, "SPARK_MAIN_CAPTURE_MISMATCH");
                    if (["DECLINED", "CANCELLED"].includes(main.paymentState))
                        this.anomaly(s, "SPARK_LATE_CAPTURE_AFTER_FINAL_NEGATIVE");
                }
            }
            for (const main of snapshot.sales) {
                if ((main.requestKey || main.providerSessionId || main.hasCommittedFulfillment) && !sessions.some(s => s.sale_id === main.saleId))
                    this.anomaly(null, "SPARK_MAIN_SESSION_MISSING", undefined, main.saleId, main.providerSessionId);
            }
            const voids = this.journal.voids();
            for (const intent of voids) {
                const main = snapshot.voids.find(v => v.actionId === intent.action_id);
                if (!main || main.saleId !== intent.sale_id || ["VOIDED","DECLINED"].includes(main.state) && intent.state !== main.state) {
                    this.journal.blockVoidRecovery(intent.action_id, "SPARK_VOID_JOURNAL_MISMATCH");
                    this.anomaly(this.session(intent.spark_id), "SPARK_VOID_JOURNAL_MISMATCH");
                }
            }
            for (const main of snapshot.voids)
                if (!voids.some(v => v.action_id === main.actionId)) {
                    this.journal.blockVoidRecovery(main.actionId, "SPARK_VOID_INTENT_UNBOUND");
                    this.anomaly(sessions.find(s => s.sale_id === main.saleId) ?? null, "SPARK_VOID_INTENT_UNBOUND", undefined, main.saleId);
                }
            return this.journal.notices();
        });
    }
    private anomaly(s: SparkJournalSession | null, code: string, row?: NayaxSparkObservation, saleId?: string, sessionId?: string | null): void {
        if (s)
            this.journal.exception(s.spark_id, code);
        const proof = s?.capture ? this.captureProof(s) : null;
        const facts: Omit<PaymentEvidenceNotice,"noticeId"> = {
            saleId: s?.sale_id ?? saleId ?? null, provider: "NAYAX_SPARK", bindingDigest: this.bindingDigest, providerSessionId: s?.spark_id ?? row?.sparkTransactionId ?? sessionId ?? null,
            providerTransactionId: proof?.providerTransactionId ?? (decimalId(row?.nayaxTransactionId)?row!.nayaxTransactionId:null),
            amountCents: proof?.amountCents ?? (Number.isSafeInteger(row?.amountCents)&&row!.amountCents!>0&&row!.amountCents!<=99_999_999?row!.amountCents:null),
            currency: "USD", captureConfirmed: Boolean(proof), code };
        const notice: PaymentEvidenceNotice = {noticeId:`sha256:${digest({facts,receipt:row?.receiptId??null})}`,...facts};
        this.journal.notice(notice);
    }
    close(): void { this.journal.close(); }
    private session(id: string): SparkJournalSession { if (!SPARK_GUID.test(id))
        throw this.proofError(); const s = this.journal.bySession(id); if (!s)
        throw new VaultError("SPARK_SESSION_NOT_BOUND", "Spark session has no durable purchase", 503); return s; }
    private captureProof(s: SparkJournalSession): Capture {
        if (!s.capture)
            throw this.proofError();
        const p = JSON.parse(s.capture) as Capture;
        if (!decimalId(p.providerTransactionId) || p.bindingDigest !== this.bindingDigest || p.amountCents !== s.total_cents || p.currency !== s.currency || !validMachineTime(p.machineAuTime) || !this.receiptMatchesStage(p.receiptId))
            throw this.proofError();
        return p;
    }
    private captured(s: SparkJournalSession): PaymentSessionResult { return { ...this.result(s, "SETTLED"), providerTransactionId: this.captureProof(s).providerTransactionId }; }
    private result(s: SparkJournalSession, state: PaymentSessionResult["state"]): PaymentSessionResult { return { providerSessionId: s.spark_id, originalRequestDigest: s.request_digest, state }; }
    private receiptMatchesStage(id: string): boolean { return new RegExp(`^spark-${this.options.environment === "PRODUCTION" ? "production" : "sandbox"}:[a-f0-9]{64}$`).test(id); }
    private callbackTerminal(): string { return this.options.callbackTerminalIdRepresentation === "HW_SERIAL" ? this.options.hwSerial : this.options.nayaxMachineId; }
    private now(): number { const n = this.options.now?.() ?? Date.now(); if (!Number.isSafeInteger(n) || n <= 0)
        throw this.proofError(); return n; }
    private serial<T>(fn: () => Promise<T>): Promise<T> { const result = this.queue.then(fn); this.queue = result.catch(() => { }); return result; }
    private proofError(): VaultError { return new VaultError("SPARK_OBSERVATION_BINDING_INVALID", "Spark payment evidence requires review", 503); }
}
function validTerminal(v: unknown): v is string { return typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v); }
function protocolSourceError(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && error.code.startsWith("SPARK_"); }
function decimalId(v: unknown): v is string { return typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n; }
function validBrands(v: unknown): v is string[] { return Array.isArray(v) && v.length <= 40 && v.every(s => typeof s === "string" && /^[A-Za-z0-9 _-]{1,40}$/.test(s)) && new Set(v).size === v.length; }
function validMachineTime(v: unknown): v is string {
    if (typeof v !== "string" || !/^\d{17}$/.test(v))
        return false;
    const y = Number(v.slice(0, 4)), m = Number(v.slice(4, 6)), d = Number(v.slice(6, 8));
    return y >= 2000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && Number(v.slice(8, 10)) <= 23 && Number(v.slice(10, 12)) <= 59 && Number(v.slice(12, 14)) <= 59;
}

/** Stage-aware name; the historical test export remains compatible. */
export { NayaxSparkTestAdapter as NayaxSparkAdapter };
export type NayaxSparkOptions = NayaxSparkTestOptions;
