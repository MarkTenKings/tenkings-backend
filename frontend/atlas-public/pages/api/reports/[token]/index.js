import { approvedReportHandler } from '../../../../lib/server/approved-report-http.mjs';
export const config = { api: { bodyParser: false, responseLimit: false }, maxDuration: 40 };
export default approvedReportHandler();
