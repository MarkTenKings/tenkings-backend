import AccountWorkspace from '../components/AccountWorkspace';
import { customerPage } from '../lib/server/page.mjs';
export default AccountWorkspace;
export const getServerSideProps = context => {
  const value = context.query?.draft;
  const resumeDraftId = typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value) ? value : null;
  return customerPage(context, { initialView: 'submit', resumeDraftId });
};
