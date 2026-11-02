// End-to-end checks against a real Directus. Run with `npm run test:e2e`.
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';

const B = process.env.E2E_URL;
const UP = path.join(process.env.E2E_DATA, 'uploads');
let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
	condition ? pass++ : fail++;
	console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition ? '' : `  -> ${JSON.stringify(detail).slice(0, 300)}`}`);
};
const j = async (method, url, body, headers = {}, token = T) => {
	const response = await fetch(B + url, {
		method,
		headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { s: response.status, d: data };
};
let T = null;
T = (await j('POST', '/auth/login', { email: 'admin@example.com', password: 'e2e-password' })).d.data.access_token;
const mk = async (collection, fields) => {
	const r = await j('POST', '/collections', { collection, schema: {}, meta: {}, fields });
	if (r.s !== 200) console.log('could not create', collection, JSON.stringify(r.d));
};
const uuidPk = { field: 'id', type: 'uuid', schema: { is_primary_key: true }, meta: { special: ['uuid'], hidden: true } };
const intPk = { field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true }, meta: {} };

const vu=(await j('POST','/users',{email:'gone@example.com'})).d.data.id;
const ins=await j('POST','/user-cleanup-endpoint/inspect',{userIds:[vu]});
const del2=await j('POST','/user-cleanup-endpoint/delete',{userIds:[vu],resolutions:[]});
ok('uc: delete ok',del2.s==200,{ins:ins.d,del2});
const act=await j('GET',`/activity?filter[collection][_eq]=directus_users&filter[item][_eq]=${vu}&filter[action][_eq]=delete`);
ok('uc: activity row written',act.d.data?.length==1&&act.d.data[0].user,act.d);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
