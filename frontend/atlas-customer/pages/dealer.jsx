import DealerWorkspace from '../components/dealer/DealerWorkspace';
import {customerPage} from '../lib/server/page.mjs';
export default DealerWorkspace;
export const getServerSideProps=context=>customerPage(context);
