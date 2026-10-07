import AccountWorkspace from '../components/AccountWorkspace';
import { customerPage } from '../lib/server/page.mjs';
export default AccountWorkspace;
export const getServerSideProps = context => customerPage(context, { initialView: 'profile' });
