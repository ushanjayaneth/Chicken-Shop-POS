import {createApp as createRetailApp} from '../../server/app';
import {initialize} from './engine-seed';
export const createApp=(options:Parameters<typeof createRetailApp>[0]={})=>createRetailApp({...options,initialize});
