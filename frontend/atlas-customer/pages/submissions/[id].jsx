import AccountWorkspace from '../../components/AccountWorkspace';
import { privateHeaders, UUID } from '../../lib/server/policy.mjs';
import { customerPage } from '../../lib/server/page.mjs';
export default AccountWorkspace;
export function getServerSideProps(context) {
    const { res, params } = context;
    privateHeaders(res);
    if (!UUID.test(params.id)) return { notFound: true };
    return customerPage(context, { submissionId: params.id });
}
