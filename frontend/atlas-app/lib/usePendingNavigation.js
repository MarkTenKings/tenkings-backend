import { useEffect, useRef } from 'react';
import Router from 'next/router';
import { installPendingNavigationGuard } from './pending-navigation.mjs';
export function usePendingNavigation(isPending,onBlocked){
    const callbacks=useRef({isPending,onBlocked});callbacks.current={isPending,onBlocked};
    useEffect(()=>installPendingNavigationGuard({window,document,router:Router,
        isPending:()=>callbacks.current.isPending(),onBlocked:message=>callbacks.current.onBlocked?.(message)}),[]);
}
