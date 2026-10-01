import DealerHandoff from '../../components/dealer/DealerHandoff';
import {customerPage} from '../../lib/server/page.mjs';
export default DealerHandoff;
export const getServerSideProps=context=>customerPage(context);
