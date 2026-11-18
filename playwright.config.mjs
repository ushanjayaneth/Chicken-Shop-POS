import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'**/*.spec.mjs',workers:1,retries:0,timeout:90000,
  expect:{timeout:10000},reporter:[['list']],
  use:{actionTimeout:10000,viewport:{width:1440,height:1000},timezoneId:'Asia/Colombo',serviceWorkers:'block',trace:'retain-on-failure',screenshot:'only-on-failure'}
});