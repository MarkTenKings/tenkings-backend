import { createContext } from 'react';
export const VerifiedImageContext = createContext({ pool: null, blocked: false });
export const VERIFIED_IMAGE_ACCESS_ENDED = 'atlas:verified-image-access-ended';
