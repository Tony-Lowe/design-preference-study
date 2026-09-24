import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({root:'static',base:'/design-preference-study/',publicDir:path.resolve('public'),plugins:[react()],resolve:{alias:{'@':path.resolve('.')}},build:{outDir:path.resolve('web-dist'),emptyOutDir:true}});
