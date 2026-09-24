import cloudbase from '@cloudbase/node-sdk';

export function createCloudbaseStore({envId=process.env.CLOUDBASE_ENV_ID,collection='study_relay_answers'}={}){
  if(!envId)throw Error('CLOUDBASE_ENV_ID is required');
  // HTTP functions use the CloudBase API key injected as CLOUDBASE_APIKEY.
  // The Node SDK reads it from the environment; it never reaches the browser.
  const app=cloudbase.init({env:envId});
  const records=app.database().collection(collection);
  return {
    async get(id){const result=await records.doc(id).get();return result.data?.[0]??null;},
    async put(id,record){const {_id,...data}=record;await records.doc(id).set(data);},
    async delete(id){await records.doc(id).remove();},
    async pending(limit=50){const result=await records.where({imported:false,withdrawn:false}).limit(limit).get();return result.data??[];},
    async withdrawals(limit=50){const result=await records.where({withdrawn:true}).limit(limit).get();return result.data??[];},
    async ackWithdrawal(id){const current=await this.get(id);if(!current?.withdrawn)return false;await records.doc(id).remove();return true;},
    async markImported(id,digest){const current=await this.get(id);if(!current||current.withdrawn||current.digest!==digest)return false;await records.doc(id).update({imported:true,importedAt:new Date().toISOString()});return true;}
  };
}
