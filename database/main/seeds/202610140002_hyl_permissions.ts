import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { hylPermissionSets } from '../../seed-data/hyl-permissions.js';
export default defineSeed({
 name:'202610140002_hyl_permissions',
 async run({query}) {
  for(const set of hylPermissionSets){
   if(await query.selectFrom('authorizationPermissionSets').select('id').where('key','=',set.key).executeTakeFirst())continue;
   const now=new Date();
   await query.insertInto('authorizationPermissionSets').values({id:set.key,key:set.key,title:encodeAuthorizationTitle(set.title),grants:JSON.stringify(set.grants),createdAt:now,updatedAt:now}).execute();
  }
 }
});
