import { spawnSync } from 'node:child_process';
for(const service of ['tenant','customer','workorder','booking','inventory','billing']) {
 const result=spawnSync('docker',['build','-f','infrastructure/docker/service.Dockerfile','--build-arg','SERVICE='+service,'-t','motoros/'+service+':milestone5','.'],{stdio:'inherit'});
 if(result.status!==0)throw new Error('Service image build failed: '+service);
}
