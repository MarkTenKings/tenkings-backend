import type { GetServerSideProps } from 'next';
import { isMainSiteHost, siteRouteConfig } from '../siteRoutes';

/** No session/private data is serialized into the page. The bearer guard runs in the API. */
export const mainStaffPageProps: GetServerSideProps = async ({ req, res }) => {
  if (!isMainSiteHost(req.headers.host, siteRouteConfig(process.env))) return { notFound: true };
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return { props: {} };
};
