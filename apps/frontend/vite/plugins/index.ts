import vue from '@vitejs/plugin-vue';
import {  Plugin } from 'vite';
import autoImport from './autoImport';
import setupMockPlugin from './mock';

export default function setupPlugins(isBuild: boolean, env:ImportMetaEnv) {
  const plugins: Plugin[] = [vue()]

  // console.log(env);


  plugins.push(setupMockPlugin(isBuild))
  autoImport(plugins)
  return plugins
}