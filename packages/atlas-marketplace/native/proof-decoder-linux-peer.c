#define _GNU_SOURCE
#define NAPI_VERSION 8
#include <node_api.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdatomic.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <sys/vfs.h>
#include <sys/syscall.h>
#include <linux/magic.h>
#include <dirent.h>
#include <sys/sysmacros.h>
#include <sys/file.h>

#ifndef SO_PEERPIDFD
#error "Linux headers with SO_PEERPIDFD are required; no PID lookup fallback"
#endif

/* Observations only. This module grants no decoder execution authority. */
static const napi_type_tag peer_tag = {UINT64_C(0x9ed6046795eb4702),UINT64_C(0xb521ab4c6b604272)};
static _Atomic unsigned int active_peers = 0;
typedef struct {
  int socket_fd, pid_fd;
  dev_t device;
  ino_t inode;
  struct ucred credentials;
} peer_record;

static napi_value fail(napi_env env, const char *code) {
  napi_throw_error(env,code,code); return NULL;
}
#define NAPI(call) do {if ((call)!=napi_ok) return fail(env,"DECODER_NATIVE_API");} while(0)

static void release_peer(peer_record *peer) {
  if (peer->pid_fd>=0) {close(peer->pid_fd); peer->pid_fd=-1; atomic_fetch_sub(&active_peers,1);}
}
static void finalize_peer(napi_env env,void *data,void *hint) {
  (void)env;(void)hint;peer_record *peer=data;release_peer(peer);free(peer);
}
static peer_record *get_peer(napi_env env,napi_value value) {
  bool matches=false;void *data=NULL;
  if(napi_check_object_type_tag(env,value,&peer_tag,&matches)!=napi_ok||!matches||
     napi_unwrap(env,value,&data)!=napi_ok||!data) {fail(env,"DECODER_NATIVE_PEER");return NULL;}
  return data;
}
static napi_value capture(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2];double number;
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=1||napi_get_value_double(env,args[0],&number)!=napi_ok||
     !(number>=0&&number<=INT_MAX)||number!=(int)number)return fail(env,"DECODER_NATIVE_FD");
  int fd=(int)number,domain=0,type=0,pidfd=-1;socklen_t length;
  struct stat before,after;struct ucred credentials;struct sockaddr_un address;
  if(fstat(fd,&before)<0||!S_ISSOCK(before.st_mode))return fail(env,"DECODER_NATIVE_SOCKET");
  length=sizeof(domain);
  if(getsockopt(fd,SOL_SOCKET,SO_DOMAIN,&domain,&length)<0||length!=sizeof(domain)||domain!=AF_UNIX)
    return fail(env,"DECODER_NATIVE_SOCKET");
  length=sizeof(type);
  if(getsockopt(fd,SOL_SOCKET,SO_TYPE,&type,&length)<0||length!=sizeof(type)||type!=SOCK_STREAM)
    return fail(env,"DECODER_NATIVE_SOCKET");
  length=sizeof(address);
  if(getpeername(fd,(struct sockaddr *)&address,&length)<0||address.sun_family!=AF_UNIX)
    return fail(env,"DECODER_NATIVE_SOCKET");
  length=sizeof(credentials);
  if(getsockopt(fd,SOL_SOCKET,SO_PEERCRED,&credentials,&length)<0||length!=sizeof(credentials)||credentials.pid<=0)
    return fail(env,"DECODER_NATIVE_PEER");
  if(atomic_fetch_add(&active_peers,1)>=128) {
    atomic_fetch_sub(&active_peers,1);return fail(env,"DECODER_NATIVE_CAPACITY");
  }
  length=sizeof(pidfd);
  if(getsockopt(fd,SOL_SOCKET,SO_PEERPIDFD,&pidfd,&length)<0||length!=sizeof(pidfd)||pidfd<0) {
    if(pidfd>=0)close(pidfd);
    atomic_fetch_sub(&active_peers,1);return fail(env,"DECODER_NATIVE_PIDFD");
  }
  if(fcntl(pidfd,F_SETFD,FD_CLOEXEC)<0||fstat(fd,&after)<0||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino) {
    close(pidfd);atomic_fetch_sub(&active_peers,1);return fail(env,"DECODER_NATIVE_SOCKET_CHANGED");
  }
  peer_record *peer=calloc(1,sizeof(*peer));
  if(!peer){close(pidfd);atomic_fetch_sub(&active_peers,1);return fail(env,"DECODER_NATIVE_MEMORY");}
  peer->socket_fd=fd;peer->pid_fd=pidfd;peer->device=before.st_dev;peer->inode=before.st_ino;peer->credentials=credentials;
  napi_value value;
  if(napi_create_object(env,&value)!=napi_ok||napi_type_tag_object(env,value,&peer_tag)!=napi_ok||
     napi_wrap(env,value,peer,finalize_peer,NULL,NULL)!=napi_ok) {
    release_peer(peer);free(peer);return fail(env,"DECODER_NATIVE_API");
  }
  return value;
}
static napi_value inspect(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2],result,value;
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=1)return fail(env,"DECODER_NATIVE_PEER");
  peer_record *peer=get_peer(env,args[0]);if(!peer)return NULL;
  bool alive=false,same_socket=false;
  if(peer->pid_fd>=0) {
    struct pollfd descriptor={.fd=peer->pid_fd,.events=POLLIN};
    int ready=poll(&descriptor,1,0);
    if(ready<0)return fail(env,"DECODER_NATIVE_POLL");
    alive=ready==0;
    struct stat observed;
    same_socket=fstat(peer->socket_fd,&observed)==0&&S_ISSOCK(observed.st_mode)&&
                observed.st_dev==peer->device&&observed.st_ino==peer->inode;
  }
  NAPI(napi_create_object(env,&result));
  NAPI(napi_create_int32(env,peer->credentials.pid,&value));NAPI(napi_set_named_property(env,result,"pid",value));
  NAPI(napi_create_uint32(env,peer->credentials.uid,&value));NAPI(napi_set_named_property(env,result,"uid",value));
  NAPI(napi_create_uint32(env,peer->credentials.gid,&value));NAPI(napi_set_named_property(env,result,"gid",value));
  NAPI(napi_get_boolean(env,alive,&value));NAPI(napi_set_named_property(env,result,"processAlive",value));
  NAPI(napi_get_boolean(env,same_socket,&value));NAPI(napi_set_named_property(env,result,"socketDescriptorMatches",value));
  NAPI(napi_get_boolean(env,peer->pid_fd<0,&value));NAPI(napi_set_named_property(env,result,"closed",value));
  return result;
}
static napi_value close_peer(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2],result;
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=1)return fail(env,"DECODER_NATIVE_PEER");
  peer_record *peer=get_peer(env,args[0]);if(!peer)return NULL;
  release_peer(peer);NAPI(napi_get_undefined(env,&result));return result;
}
static napi_value boottime(napi_env env,napi_callback_info info) {
  size_t argc=1;napi_value arg,result;struct timespec now;
  NAPI(napi_get_cb_info(env,info,&argc,&arg,NULL,NULL));
  if(argc!=0||clock_gettime(CLOCK_BOOTTIME,&now)<0||now.tv_sec<0||now.tv_nsec<0||now.tv_nsec>=1000000000L)
    return fail(env,"DECODER_NATIVE_CLOCK");
  if((uint64_t)now.tv_sec>(UINT64_MAX-(uint64_t)now.tv_nsec)/UINT64_C(1000000000))return fail(env,"DECODER_NATIVE_CLOCK");
  NAPI(napi_create_bigint_uint64(env,(uint64_t)now.tv_sec*UINT64_C(1000000000)+(uint64_t)now.tv_nsec,&result));
  return result;
}

/* Fixed whole-parent containment only. No caller-selected cgroup path, thaw,
 * process-number signalling, daemon execution, or receipt deserialization. */
static const napi_type_tag group_tag={UINT64_C(0x246b7582a19c4c20),UINT64_C(0x88be631fd0b66aaa)};
static _Atomic unsigned int active_groups=0;
typedef struct {
  int root_fd,group_fd,events_fd,freeze_fd,kill_fd;
  dev_t root_device,device;
  ino_t root_inode,inode;
  bool counted,quarantined;
} group_record;

static int protected_dir(int parent,const char *name) {
  int fd=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);struct stat st;
  if(fd<0)return -1;
  if(fstat(fd,&st)<0||!S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&0022)!=0){close(fd);return -1;}
  return fd;
}
/* Additive restart fencing. The fixed lock inode is never created, replaced or
 * unlinked here. A private object retains LOCK_EX until process exit/GC; there
 * is no caller-selected pathname, PID lookup, unlock or admission operation. */
static const napi_type_tag recovery_lock_tag={UINT64_C(0xa6c7f20329cb41e1),UINT64_C(0xb521830697804fd2)};
static _Atomic unsigned int active_recovery_locks=0;
typedef struct {int directory_fd,lock_fd;dev_t directory_dev,lock_dev;ino_t directory_ino,lock_ino;bool counted;} recovery_lock_record;
static int recovery_directory(void) {
  int fd=protected_dir(AT_FDCWD,"/");const char *parts[]={"var","lib","atlas-r2-decoder-recovery"};
  for(size_t i=0;i<sizeof(parts)/sizeof(parts[0])&&fd>=0;i++){
    int next=protected_dir(fd,parts[i]);close(fd);fd=next;
  }
  struct stat st;
  if(fd>=0&&(fstat(fd,&st)<0||(st.st_mode&07777)!=0700)){close(fd);fd=-1;}
  return fd;
}
static bool recovery_lock_identity(recovery_lock_record *record) {
  if(record->directory_fd<0||record->lock_fd<0)return false;
  int directory=recovery_directory();struct stat dir,lock,current;bool same=false;
  if(directory>=0&&fstat(directory,&dir)==0&&fstat(record->lock_fd,&lock)==0&&
     fstatat(directory,"owner.lock",&current,AT_SYMLINK_NOFOLLOW)==0){
    same=dir.st_dev==record->directory_dev&&dir.st_ino==record->directory_ino&&
      S_ISREG(lock.st_mode)&&lock.st_uid==0&&lock.st_nlink==1&&(lock.st_mode&07777)==0600&&lock.st_size==0&&
      lock.st_dev==record->lock_dev&&lock.st_ino==record->lock_ino&&
      current.st_dev==lock.st_dev&&current.st_ino==lock.st_ino&&current.st_mode==lock.st_mode&&current.st_uid==lock.st_uid;
  }
  if(directory>=0)close(directory);
  return same;
}
static void finalize_recovery_lock(napi_env env,void *data,void *hint) {
  (void)env;(void)hint;recovery_lock_record *record=data;
  if(record->lock_fd>=0)close(record->lock_fd);
  if(record->directory_fd>=0)close(record->directory_fd);
  if(record->counted)atomic_fetch_sub(&active_recovery_locks,1);
  free(record);
}
static napi_value capture_recovery_lock(napi_env env,napi_callback_info info) {
  size_t argc=1;napi_value arg,value;struct stat dir,lock;
  NAPI(napi_get_cb_info(env,info,&argc,&arg,NULL,NULL));
  if(argc!=0||geteuid()!=0||getegid()!=0)return fail(env,"DECODER_NATIVE_RECOVERY_LOCK");
  if(atomic_fetch_add(&active_recovery_locks,1)!=0){atomic_fetch_sub(&active_recovery_locks,1);return fail(env,"DECODER_NATIVE_RECOVERY_BUSY");}
  recovery_lock_record *record=calloc(1,sizeof(*record));
  if(!record){atomic_fetch_sub(&active_recovery_locks,1);return fail(env,"DECODER_NATIVE_MEMORY");}
  record->counted=true;record->directory_fd=-1;record->lock_fd=-1;
  record->directory_fd=recovery_directory();
  if(record->directory_fd<0||fstat(record->directory_fd,&dir)<0)goto refused;
  record->lock_fd=openat(record->directory_fd,"owner.lock",O_RDWR|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);
  if(record->lock_fd<0||fstat(record->lock_fd,&lock)<0||!S_ISREG(lock.st_mode)||lock.st_uid!=0||
     lock.st_nlink!=1||(lock.st_mode&07777)!=0600||lock.st_size!=0||flock(record->lock_fd,LOCK_EX|LOCK_NB)<0)goto refused;
  record->directory_dev=dir.st_dev;record->directory_ino=dir.st_ino;record->lock_dev=lock.st_dev;record->lock_ino=lock.st_ino;
  if(!recovery_lock_identity(record))goto refused;
  if(napi_create_object(env,&value)!=napi_ok||napi_type_tag_object(env,value,&recovery_lock_tag)!=napi_ok||
     napi_wrap(env,value,record,finalize_recovery_lock,NULL,NULL)!=napi_ok)goto refused;
  return value;
 refused:finalize_recovery_lock(env,record,NULL);return fail(env,"DECODER_NATIVE_RECOVERY_LOCK");
}
static napi_value inspect_recovery_lock(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2],value;bool tagged=false;void *data=NULL;
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=1||napi_check_object_type_tag(env,args[0],&recovery_lock_tag,&tagged)!=napi_ok||!tagged||
     napi_unwrap(env,args[0],&data)!=napi_ok||!data)return fail(env,"DECODER_NATIVE_RECOVERY_LOCK");
  NAPI(napi_get_boolean(env,recovery_lock_identity(data),&value));return value;
}
static int cgroup_root(void) {
  int fd=protected_dir(AT_FDCWD,"/");const char *parts[]={"sys","fs","cgroup"};
  for(size_t i=0;i<sizeof(parts)/sizeof(parts[0])&&fd>=0;i++){
    int next=protected_dir(fd,parts[i]);close(fd);fd=next;
  }
  struct statfs fs;
  if(fd>=0&&(fstatfs(fd,&fs)<0||(unsigned long)fs.f_type!=(unsigned long)CGROUP2_SUPER_MAGIC)){close(fd);fd=-1;}
  return fd;
}
static int group_file(int parent,const char *name,int flags) {
  int fd=openat(parent,name,flags|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);struct stat st;
  if(fd<0)return -1;
  if(fstat(fd,&st)<0||!S_ISREG(st.st_mode)||st.st_uid!=0||(st.st_mode&0022)!=0){close(fd);return -1;}
  return fd;
}
static ssize_t bounded_text(int fd,char *text,size_t capacity) {
  ssize_t size;
  do{size=pread(fd,text,capacity-1,0);}while(size<0&&errno==EINTR);
  if(size<=0||(size_t)size>=capacity-1)return -1;
  text[size]='\0';return size;
}
static void release_group(group_record *group) {
  int *fds[]={&group->root_fd,&group->group_fd,&group->events_fd,&group->freeze_fd,&group->kill_fd};
  for(size_t i=0;i<sizeof(fds)/sizeof(fds[0]);i++)if(*fds[i]>=0){close(*fds[i]);*fds[i]=-1;}
  if(group->counted){group->counted=false;atomic_fetch_sub(&active_groups,1);}
}
static void finalize_group(napi_env env,void *data,void *hint) {
  (void)env;(void)hint;group_record *group=data;release_group(group);free(group);
}
static group_record *get_group(napi_env env,napi_value value) {
  bool matches=false;void *data=NULL;
  if(napi_check_object_type_tag(env,value,&group_tag,&matches)!=napi_ok||!matches||
     napi_unwrap(env,value,&data)!=napi_ok||!data){fail(env,"DECODER_NATIVE_CGROUP");return NULL;}
  return data;
}
static bool group_identity(group_record *group) {
  if(group->root_fd<0||group->group_fd<0)return false;
  int root=cgroup_root();if(root<0)return false;
  int current=protected_dir(root,"atlasdecoder.slice");struct stat rs,gs;
  bool same=current>=0&&fstat(root,&rs)==0&&fstat(current,&gs)==0&&
    rs.st_dev==group->root_device&&rs.st_ino==group->root_inode&&
    gs.st_dev==group->device&&gs.st_ino==group->inode&&gs.st_nlink>0;
  if(current>=0)close(current);
  close(root);return same;
}
static bool group_observation(group_record *group,bool *populated,bool *requested,bool *frozen) {
  if(!group_identity(group))return false;
  char events[256],freeze[32];bool seen_populated=false,seen_frozen=false;
  if(bounded_text(group->events_fd,events,sizeof(events))<0||bounded_text(group->freeze_fd,freeze,sizeof(freeze))<0)return false;
  if(strcmp(freeze,"0\n")==0)*requested=false;
  else if(strcmp(freeze,"1\n")==0)*requested=true;
  else return false;
  char *save=NULL;
  for(char *line=strtok_r(events,"\n",&save);line;line=strtok_r(NULL,"\n",&save)){
    if(strcmp(line,"populated 0")==0||strcmp(line,"populated 1")==0){
      if(seen_populated)return false;
      seen_populated=true;*populated=line[10]=='1';
    }else if(strcmp(line,"frozen 0")==0||strcmp(line,"frozen 1")==0){
      if(seen_frozen)return false;
      seen_frozen=true;*frozen=line[7]=='1';
    }else return false;
  }
  return seen_populated&&seen_frozen&&group_identity(group);
}
static napi_value capture_group(napi_env env,napi_callback_info info) {
  size_t argc=1;napi_value arg,value;
  NAPI(napi_get_cb_info(env,info,&argc,&arg,NULL,NULL));
  if(argc!=0||geteuid()!=0)return fail(env,"DECODER_NATIVE_CGROUP_ROOT");
  if(atomic_fetch_add(&active_groups,1)>=4){atomic_fetch_sub(&active_groups,1);return fail(env,"DECODER_NATIVE_CAPACITY");}
  group_record *group=calloc(1,sizeof(*group));
  if(!group){atomic_fetch_sub(&active_groups,1);return fail(env,"DECODER_NATIVE_MEMORY");}
  group->root_fd=group->group_fd=group->events_fd=group->freeze_fd=group->kill_fd=-1;group->counted=true;
  group->root_fd=cgroup_root();
  if(group->root_fd>=0)group->group_fd=protected_dir(group->root_fd,"atlasdecoder.slice");
  struct stat rs,gs;int type=-1;char kind[32];bool p=false,r=false,f=false;
  if(group->group_fd<0||fstat(group->root_fd,&rs)<0||fstat(group->group_fd,&gs)<0)goto refused;
  group->root_device=rs.st_dev;group->root_inode=rs.st_ino;group->device=gs.st_dev;group->inode=gs.st_ino;
  type=group_file(group->group_fd,"cgroup.type",O_RDONLY);
  if(type<0||bounded_text(type,kind,sizeof(kind))<0||strcmp(kind,"domain\n")!=0)goto refused;
  close(type);type=-1;
  group->events_fd=group_file(group->group_fd,"cgroup.events",O_RDONLY);
  group->freeze_fd=group_file(group->group_fd,"cgroup.freeze",O_RDWR);
  group->kill_fd=group_file(group->group_fd,"cgroup.kill",O_WRONLY);
  if(group->events_fd<0||group->freeze_fd<0||group->kill_fd<0||!group_observation(group,&p,&r,&f))goto refused;
  if(napi_create_object(env,&value)!=napi_ok||napi_type_tag_object(env,value,&group_tag)!=napi_ok||
     napi_wrap(env,value,group,finalize_group,NULL,NULL)!=napi_ok)goto refused;
  return value;
refused:
  if(type>=0)close(type);
  release_group(group);free(group);return fail(env,"DECODER_NATIVE_CGROUP_UNAVAILABLE");
}
static napi_value group_status(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2],result,value;char text[32];
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=1)return fail(env,"DECODER_NATIVE_CGROUP");
  group_record *group=get_group(env,args[0]);if(!group)return NULL;
  bool p=true,r=true,f=true,healthy=group_observation(group,&p,&r,&f);
  NAPI(napi_create_object(env,&result));
  snprintf(text,sizeof(text),"%llu",(unsigned long long)group->device);
  NAPI(napi_create_string_utf8(env,text,NAPI_AUTO_LENGTH,&value));NAPI(napi_set_named_property(env,result,"device",value));
  snprintf(text,sizeof(text),"%llu",(unsigned long long)group->inode);
  NAPI(napi_create_string_utf8(env,text,NAPI_AUTO_LENGTH,&value));NAPI(napi_set_named_property(env,result,"inode",value));
  NAPI(napi_get_boolean(env,p,&value));NAPI(napi_set_named_property(env,result,"populated",value));
  NAPI(napi_get_boolean(env,r,&value));NAPI(napi_set_named_property(env,result,"freezeRequested",value));
  NAPI(napi_get_boolean(env,f,&value));NAPI(napi_set_named_property(env,result,"frozen",value));
  NAPI(napi_get_boolean(env,group->group_fd<0,&value));NAPI(napi_set_named_property(env,result,"closed",value));
  NAPI(napi_get_boolean(env,group->quarantined,&value));NAPI(napi_set_named_property(env,result,"quarantined",value));
  NAPI(napi_get_boolean(env,healthy,&value));NAPI(napi_set_named_property(env,result,"healthy",value));
  return result;
}
static bool write_one(int fd) {
  ssize_t count;do{count=pwrite(fd,"1\n",2,0);}while(count<0&&errno==EINTR);
  return count==2;
}
static napi_value freeze_kill_group(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2],result;
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=1)return fail(env,"DECODER_NATIVE_CGROUP");
  group_record *group=get_group(env,args[0]);if(!group)return NULL;
  group->quarantined=true;
  if(geteuid()!=0||!group_identity(group))return fail(env,"DECODER_NATIVE_CGROUP_CHANGED");
  // Attempt kill even if freeze fails; failure never becomes an empty receipt.
  bool frozen=write_one(group->freeze_fd),killed=write_one(group->kill_fd);
  if(!frozen||!killed||!group_identity(group))return fail(env,"DECODER_NATIVE_CGROUP_KILL");
  NAPI(napi_get_undefined(env,&result));return result;
}
static napi_value close_group(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2],result;
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=1)return fail(env,"DECODER_NATIVE_CGROUP");
  group_record *group=get_group(env,args[0]);if(!group)return NULL;
  release_group(group);NAPI(napi_get_undefined(env,&result));return result;
}
static napi_value assert_group_member(napi_env env,napi_callback_info info) {
  size_t argc=4,length=0;napi_value args[4],result;double number;char id[65];
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=3)return fail(env,"DECODER_NATIVE_MEMBER");
  group_record *group=get_group(env,args[0]);if(!group)return NULL;
  if(napi_get_value_double(env,args[1],&number)!=napi_ok||!(number>0&&number<=INT_MAX)||number!=(int)number||
     napi_get_value_string_utf8(env,args[2],NULL,0,&length)!=napi_ok||length!=64||
     napi_get_value_string_utf8(env,args[2],id,sizeof(id),&length)!=napi_ok||length!=64)return fail(env,"DECODER_NATIVE_MEMBER");
  for(size_t i=0;i<64;i++)if(!((id[i]>='0'&&id[i]<='9')||(id[i]>='a'&&id[i]<='f')))return fail(env,"DECODER_NATIVE_MEMBER");
  bool p=false,r=false,f=false;
  if(group->quarantined||!group_observation(group,&p,&r,&f)||!p||r||f)return fail(env,"DECODER_NATIVE_MEMBER");
  int pidfd=(int)syscall(SYS_pidfd_open,(int)number,0);
  if(pidfd<0)return fail(env,"DECODER_NATIVE_MEMBER");
  int proc=open("/proc",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC),process=-1,cgroup=-1;
  struct statfs fs;char pid[32],observed[512],expected[160];
  snprintf(pid,sizeof(pid),"%d",(int)number);
  snprintf(expected,sizeof(expected),"0::/atlasdecoder.slice/docker-%s.scope\n",id);
  bool same=false;
  if(proc>=0&&fstatfs(proc,&fs)==0&&(unsigned long)fs.f_type==(unsigned long)PROC_SUPER_MAGIC){
    process=openat(proc,pid,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
    if(process>=0)cgroup=openat(process,"cgroup",O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);
    if(cgroup>=0&&bounded_text(cgroup,observed,sizeof(observed))>0&&strcmp(observed,expected)==0){
      struct pollfd lifetime={.fd=pidfd,.events=POLLIN};
      same=poll(&lifetime,1,0)==0&&group_observation(group,&p,&r,&f)&&p&&!r&&!f;
    }
  }
  if(cgroup>=0)close(cgroup);
  if(process>=0)close(process);
  if(proc>=0)close(proc);
  close(pidfd);
  if(!same)return fail(env,"DECODER_NATIVE_MEMBER");
  NAPI(napi_get_boolean(env,true,&result));return result;
}
static napi_value notify_supervisor(napi_env env,napi_callback_info info) {
  size_t argc=2,length=0;napi_value args[2],result;char mode[16];
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));
  if(argc!=1||geteuid()!=0||napi_get_value_string_utf8(env,args[0],NULL,0,&length)!=napi_ok||length>=sizeof(mode)||
     napi_get_value_string_utf8(env,args[0],mode,sizeof(mode),&length)!=napi_ok)return fail(env,"DECODER_NATIVE_NOTIFY");
  const char *message=NULL;
  if(strcmp(mode,"ready")==0)message="READY=1\nWATCHDOG=1";
  else if(strcmp(mode,"watchdog")==0)message="WATCHDOG=1";
  else return fail(env,"DECODER_NATIVE_NOTIFY");
  // Only these non-secret systemd protocol variables are read. No arbitrary
  // endpoint, notification text, environment dump or caller-supplied PID.
  const char *endpoint=getenv("NOTIFY_SOCKET"),*interval=getenv("WATCHDOG_USEC");
  if(!endpoint||strcmp(endpoint,"/run/systemd/notify")!=0||!interval||strcmp(interval,"500000")!=0)
    return fail(env,"DECODER_NATIVE_NOTIFY_CONTEXT");
  struct stat st;
  if(lstat(endpoint,&st)<0||!S_ISSOCK(st.st_mode)||st.st_uid!=0)return fail(env,"DECODER_NATIVE_NOTIFY_CONTEXT");
  int fd=socket(AF_UNIX,SOCK_DGRAM|SOCK_CLOEXEC|SOCK_NONBLOCK,0);
  if(fd<0)return fail(env,"DECODER_NATIVE_NOTIFY");
  struct sockaddr_un address={.sun_family=AF_UNIX};
  memcpy(address.sun_path,"/run/systemd/notify",sizeof("/run/systemd/notify"));
  ssize_t count=sendto(fd,message,strlen(message),MSG_NOSIGNAL,(struct sockaddr *)&address,sizeof(address));
  close(fd);
  if(count<0||(size_t)count!=strlen(message))return fail(env,"DECODER_NATIVE_NOTIFY");
  NAPI(napi_get_boolean(env,true,&result));return result;
}
/* Input release is gated by an asynchronous, bounded live-kernel observation.
 * No caller-selected paths, namespaces, process signals or file contents. */
#define WORKER_TASKS 32
#define WORKER_FDS 64
#define WORKER_NS 6
static const char *worker_ns_names[WORKER_NS]={"pid","ipc","net","mnt","cgroup","user"};
static const char *worker_resources[]={"memory.max","memory.swap.max","cpu.max","pids.max","pids.current","memory.events","cgroup.procs"};
static const char *worker_files[]={"/opt/atlas-proof-decoder/worker.mjs","/opt/atlas-proof-decoder/contract.mjs","/opt/atlas-proof-decoder/proof-decoder-protocol.mjs","/opt/atlas-proof-decoder/proof-decoder-worker-protocol.mjs","/opt/atlas-proof-decoder/proof-image-decode.mjs"};
static const napi_type_tag worker_tag={UINT64_C(0xa57c305fa03b43a7),UINT64_C(0x815c618e7c75a643)};
static _Atomic unsigned int active_workers=0;
typedef struct {int tid;char status[8192],apparmor[256],ns[WORKER_NS][64];} worker_task;
typedef struct {int number;char target[4096],info[4096];struct stat st;uint64_t mount_id;bool root_match;} worker_fd;
typedef struct {
  char executable[512],command[512],mounts[65536],limits[8192],network[8192];size_t command_size;
  char resources[7][4096],host_ns[WORKER_NS][64];
  worker_task tasks[WORKER_TASKS];size_t task_count;
  worker_fd fds[WORKER_FDS];size_t fd_count;
} worker_snapshot;
typedef struct {
  group_record group;int pid_fd,proc_fd,scope_fd,pid;
  dev_t scope_device,proc_device;ino_t scope_inode,proc_inode;
  char id[65],scope[96];uint64_t deadline;
  bool counted,closed;worker_snapshot *snapshot;
} worker_record;
typedef struct {worker_record *record;napi_deferred deferred;napi_async_work work;const char *error;} worker_work;
static bool worker_clock(uint64_t *now) {
  struct timespec ts;if(clock_gettime(CLOCK_BOOTTIME,&ts)<0||ts.tv_sec<0||ts.tv_nsec<0||ts.tv_nsec>=1000000000L||(uint64_t)ts.tv_sec>(UINT64_MAX-(uint64_t)ts.tv_nsec)/UINT64_C(1000000000))return false;
  *now=(uint64_t)ts.tv_sec*UINT64_C(1000000000)+(uint64_t)ts.tv_nsec;return true;
}
static bool worker_time(worker_record *w) {uint64_t now;struct pollfd p={.fd=w->pid_fd,.events=POLLIN};return !w->closed&&worker_clock(&now)&&now<w->deadline&&w->pid_fd>=0&&poll(&p,1,0)==0;}
static bool worker_text(worker_record *w,int parent,const char *name,char *out,size_t cap,size_t *length) {
  if(!worker_time(w))return false;
  int fd=openat(parent,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);struct stat st;size_t used=0;bool ok=false;
  if(fd<0)return false;
  if(fstat(fd,&st)<0||!S_ISREG(st.st_mode))goto done;
  while(used<cap-1){if(!worker_time(w))goto done;ssize_t n=read(fd,out+used,cap-1-used);if(n<0){if(errno==EINTR)continue;goto done;}if(n==0){out[used]='\0';if(length)*length=used;ok=true;goto done;}used+=(size_t)n;}
 done:close(fd);return ok&&worker_time(w);
}
static bool worker_link(worker_record *w,int parent,const char *name,char *out,size_t cap) {
  if(!worker_time(w))return false;
  ssize_t n=readlinkat(parent,name,out,cap-1);if(n<=0||(size_t)n>=cap-1)return false;out[n]='\0';return worker_time(w);
}
static int worker_directory(int parent,const char *name) {return openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);}
static int number_compare(const void *a,const void *b){int x=*(const int *)a,y=*(const int *)b;return (x>y)-(x<y);}
static bool worker_numbers(worker_record *w,int parent,const char *name,int *out,size_t cap,size_t *count) {
  int fd=worker_directory(parent,name);if(fd<0)return false;DIR *dir=fdopendir(fd);if(!dir){close(fd);return false;}bool ok=false;size_t n=0;
  for(;;){if(!worker_time(w))goto done;errno=0;struct dirent *e=readdir(dir);if(!e){if(errno)goto done;break;}if(strcmp(e->d_name,".")==0||strcmp(e->d_name,"..")==0)continue;
    char *end;errno=0;long value=strtol(e->d_name,&end,10);if(errno||!*e->d_name||*end||value<0||value>INT_MAX||n>=cap)goto done;
    char canonical[32];snprintf(canonical,sizeof(canonical),"%ld",value);if(strcmp(canonical,e->d_name)!=0)goto done;out[n++]=(int)value;
  }
  qsort(out,n,sizeof(*out),number_compare);for(size_t i=1;i<n;i++)if(out[i]==out[i-1])goto done;*count=n;ok=true;
 done:closedir(dir);return ok;
}
static bool worker_identity(worker_record *w) {
  if(!worker_time(w))return false;
  bool p=false,r=false,f=false;
  if(!group_observation(&w->group,&p,&r,&f)||!p||r||f)return false;
  struct stat scope,proc;
  if(fstatat(w->group.group_fd,w->scope,&scope,AT_SYMLINK_NOFOLLOW)<0||!S_ISDIR(scope.st_mode)||scope.st_uid!=0||(scope.st_mode&0022)!=0||scope.st_dev!=w->scope_device||scope.st_ino!=w->scope_inode||
    fstat(w->proc_fd,&proc)<0||proc.st_dev!=w->proc_device||proc.st_ino!=w->proc_inode)return false;
  char expected[160],actual[512];snprintf(expected,sizeof(expected),"0::/atlasdecoder.slice/%s\n",w->scope);
  return worker_text(w,w->proc_fd,"cgroup",actual,sizeof(actual),NULL)&&strcmp(actual,expected)==0&&worker_time(w);
}
static void release_worker(worker_record *w) {
  if(!w||w->closed)return;
  w->closed=true;
  int *fds[]={&w->pid_fd,&w->proc_fd,&w->scope_fd,&w->group.root_fd,&w->group.group_fd,&w->group.events_fd,&w->group.freeze_fd};
  for(size_t i=0;i<sizeof(fds)/sizeof(fds[0]);i++)if(*fds[i]>=0){close(*fds[i]);*fds[i]=-1;}
  if(w->snapshot){memset(w->snapshot,0,sizeof(*w->snapshot));free(w->snapshot);w->snapshot=NULL;}
  if(w->counted){w->counted=false;atomic_fetch_sub(&active_workers,1);}
}
static void finalize_worker(napi_env env,void *data,void *hint){(void)env;(void)hint;worker_record *w=data;release_worker(w);free(w);}
static worker_record *get_worker(napi_env env,napi_value value){bool tagged=false;void *data=NULL;if(napi_check_object_type_tag(env,value,&worker_tag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,value,&data)!=napi_ok||!data){fail(env,"DECODER_NATIVE_INPUT_HANDLE");return NULL;}return data;}
static bool worker_namespaces(worker_record *w,int proc,char ns[WORKER_NS][64]) {
  int fd=worker_directory(proc,"ns");if(fd<0)return false;bool ok=true;
  for(size_t i=0;i<WORKER_NS;i++)if(!worker_link(w,fd,worker_ns_names[i],ns[i],64)){ok=false;break;}
  close(fd);return ok;
}
static bool worker_regular_matches(worker_record *w,const char *path,const struct stat *observed) {
  bool permitted=strcmp(path,"/dev/null")==0;
  for(size_t i=0;i<sizeof(worker_files)/sizeof(worker_files[0]);i++)if(strcmp(path,worker_files[i])==0)permitted=true;
  if(!permitted)return false;
  // This is the only followed proc magic link; subsequent walk forbids links.
  int at=openat(w->proc_fd,"root",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NONBLOCK);if(at<0)return false;
  char copy[512];if(strlen(path)>=sizeof(copy)){close(at);return false;}strcpy(copy,path+1);char *save=NULL,*name=strtok_r(copy,"/",&save);bool same=false;
  while(name){char *next=strtok_r(NULL,"/",&save);if(next){int fd=worker_directory(at,name);close(at);at=fd;if(at<0)return false;}else{struct stat s;same=fstatat(at,name,&s,AT_SYMLINK_NOFOLLOW)==0&&s.st_dev==observed->st_dev&&s.st_ino==observed->st_ino&&s.st_mode==observed->st_mode;break;}name=next;}
  close(at);return same&&worker_time(w);
}
/* Only metadata of explicitly allowed targets may be followed. Unknown
 * socket/path descriptors are refused before any target dereference. */
static bool worker_fd_target(const char *target) {
  if(strcmp(target,"anon_inode:[eventpoll]")==0||strcmp(target,"anon_inode:[eventfd]")==0||strcmp(target,"/dev/null")==0)return true;
  for(size_t i=0;i<sizeof(worker_files)/sizeof(worker_files[0]);i++)if(strcmp(target,worker_files[i])==0)return true;
  if(strncmp(target,"pipe:[",6)!=0)return false;
  const char *p=target+6;if(*p<'1'||*p>'9')return false;
  while(*p>='0'&&*p<='9')p++;
  return p[0]==']'&&p[1]=='\0';
}
static bool worker_fd_fields(const char *raw,uint64_t *flags,uint64_t *inode,uint64_t *mount) {
  bool seen[3]={false,false,false};const char *names[]={"flags:","ino:","mnt_id:"};uint64_t *values[]={flags,inode,mount};
  for(const char *line=raw;*line;){const char *end=strchr(line,'\n');if(!end)return false;
    for(size_t i=0;i<3;i++)if(strncmp(line,names[i],strlen(names[i]))==0){
      if(seen[i])return false;
      seen[i]=true;const char *at=line+strlen(names[i]);while(at<end&&(*at==' '||*at=='\t'))at++;
      if(at==end)return false;
      unsigned base=i==0?8:10;uint64_t value=0;
      for(;at<end;at++){if(*at<'0'||*at>'9'||(unsigned)(*at-'0')>=base||value>(UINT64_MAX-(unsigned)(*at-'0'))/base)return false;value=value*base+(unsigned)(*at-'0');}*values[i]=value;
    }line=end+1;
  }
  return seen[0]&&seen[1]&&seen[2];
}
static bool worker_fd_stat(int dir,const char *name,struct stat *st,uint64_t *mount) {
  struct statx sx;
  const unsigned required=STATX_TYPE|STATX_MODE|STATX_INO|STATX_UID|STATX_GID|STATX_MNT_ID;
  if(fstatat(dir,name,st,AT_NO_AUTOMOUNT)<0||statx(dir,name,AT_NO_AUTOMOUNT,required,&sx)<0||(sx.stx_mask&required)!=required||
    sx.stx_ino!=st->st_ino||sx.stx_mode!=st->st_mode||sx.stx_uid!=st->st_uid||sx.stx_gid!=st->st_gid||
    makedev(sx.stx_dev_major,sx.stx_dev_minor)!=st->st_dev)return false;
  *mount=sx.stx_mnt_id;return true;
}

static void execute_worker(napi_env env,void *data) {
  (void)env;worker_work *work=data;worker_record *w=work->record;worker_snapshot *s=w->snapshot;
  /* Closed phase codes disclose no observed path, descriptor contents or errno.
   * They identify the refused check, not a cause or permission to retry. */
  work->error="DECODER_NATIVE_INPUT_IDENTITY_INITIAL";
  if(!worker_identity(w))return;
  work->error="DECODER_NATIVE_INPUT_HOST_NAMESPACES";
  int host=open("/proc/1",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);
  if(host<0)return;
  bool host_ok=worker_namespaces(w,host,s->host_ns);close(host);if(!host_ok)return;
  work->error="DECODER_NATIVE_INPUT_EXECUTABLE_READ";
  if(!worker_link(w,w->proc_fd,"exe",s->executable,sizeof(s->executable)))return;
  work->error="DECODER_NATIVE_INPUT_COMMAND_READ";
  if(!worker_text(w,w->proc_fd,"cmdline",s->command,sizeof(s->command),&s->command_size))return;
  work->error="DECODER_NATIVE_INPUT_MOUNTS_READ";
  if(!worker_text(w,w->proc_fd,"mountinfo",s->mounts,sizeof(s->mounts),NULL))return;
  work->error="DECODER_NATIVE_INPUT_LIMITS_READ";
  if(!worker_text(w,w->proc_fd,"limits",s->limits,sizeof(s->limits),NULL))return;
  work->error="DECODER_NATIVE_INPUT_NETWORK_READ";
  int net=worker_directory(w->proc_fd,"net");if(net<0)return;bool net_ok=worker_text(w,net,"dev",s->network,sizeof(s->network),NULL);close(net);if(!net_ok)return;
  work->error="DECODER_NATIVE_INPUT_RESOURCES_READ";
  for(size_t i=0;i<7;i++)if(!worker_text(w,w->scope_fd,worker_resources[i],s->resources[i],sizeof(s->resources[i]),NULL))return;
  int numbers[WORKER_TASKS],again[WORKER_TASKS];size_t count=0,count_again=0;
  work->error="DECODER_NATIVE_INPUT_TASK_ENUMERATE";
  if(!worker_numbers(w,w->proc_fd,"task",numbers,WORKER_TASKS,&count)||count<1)return;
  work->error="DECODER_NATIVE_INPUT_TASK_DIRECTORY";
  int tasks=worker_directory(w->proc_fd,"task");if(tasks<0)return;bool task_ok=true;
  for(size_t i=0;i<count;i++){
    worker_task *t=&s->tasks[i];t->tid=numbers[i];char name[32];snprintf(name,sizeof(name),"%d",t->tid);int fd=worker_directory(tasks,name);
    if(fd<0){work->error=errno==ENOENT?"DECODER_NATIVE_INPUT_TASK_GONE":"DECODER_NATIVE_INPUT_TASK_OPEN";task_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_TASK_ATTR_OPEN";
    int attr=worker_directory(fd,"attr");task_ok=attr>=0;
    if(task_ok){work->error="DECODER_NATIVE_INPUT_TASK_STATUS_READ";task_ok=worker_text(w,fd,"status",t->status,sizeof(t->status),NULL);}
    if(task_ok){work->error="DECODER_NATIVE_INPUT_TASK_APPARMOR_READ";task_ok=worker_text(w,attr,"current",t->apparmor,sizeof(t->apparmor),NULL);}
    if(task_ok){work->error="DECODER_NATIVE_INPUT_TASK_NAMESPACES";task_ok=worker_namespaces(w,fd,t->ns);}
    if(attr>=0)close(attr);
    close(fd);if(!task_ok)break;
  }close(tasks);if(!task_ok)return;s->task_count=count;
  int fds[WORKER_FDS],fds_again[WORKER_FDS];size_t fd_count=0,fd_count_again=0;
  work->error="DECODER_NATIVE_INPUT_FD_ENUMERATE";
  if(!worker_numbers(w,w->proc_fd,"fd",fds,WORKER_FDS,&fd_count)||fd_count<3)return;
  work->error="DECODER_NATIVE_INPUT_FD_DIRECTORY";
  int fd_dir=worker_directory(w->proc_fd,"fd"),info_dir=worker_directory(w->proc_fd,"fdinfo");
  if(fd_dir<0||info_dir<0){if(fd_dir>=0)close(fd_dir);if(info_dir>=0)close(info_dir);return;}bool fd_ok=true;
  for(size_t i=0;i<fd_count;i++){
    worker_fd *f=&s->fds[i];f->number=fds[i];char name[32];snprintf(name,sizeof(name),"%d",f->number);
    uint64_t flags,ino,mount,after_flags,after_ino,after_mount,final_mount;struct stat final_stat;
    work->error="DECODER_NATIVE_INPUT_FD_LINK_READ";
    if(!worker_link(w,fd_dir,name,f->target,sizeof(f->target))){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_TARGET";
    if(!worker_fd_target(f->target)){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_INFO_READ";
    if(!worker_text(w,info_dir,name,f->info,sizeof(f->info),NULL)){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_INFO_FIELDS";
    if(!worker_fd_fields(f->info,&flags,&ino,&mount)){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_STAT_READ";
    if(!worker_fd_stat(fd_dir,name,&f->st,&f->mount_id)){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_IDENTITY_MATCH";
    if(ino!=f->st.st_ino||mount!=f->mount_id){fd_ok=false;break;}
    if(S_ISREG(f->st.st_mode)||S_ISCHR(f->st.st_mode))f->root_match=worker_regular_matches(w,f->target,&f->st);
    char after[4096],after_info[4096];
    work->error="DECODER_NATIVE_INPUT_FD_LINK_REREAD";
    if(!worker_link(w,fd_dir,name,after,sizeof(after))){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_TARGET_CHANGED";
    if(strcmp(after,f->target)!=0){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_INFO_REREAD";
    if(!worker_text(w,info_dir,name,after_info,sizeof(after_info),NULL)){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_INFO_REPARSE";
    if(!worker_fd_fields(after_info,&after_flags,&after_ino,&after_mount)){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_FIELDS_CHANGED";
    if(flags!=after_flags||ino!=after_ino||mount!=after_mount){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_STAT_REREAD";
    if(!worker_fd_stat(fd_dir,name,&final_stat,&final_mount)){fd_ok=false;break;}
    work->error="DECODER_NATIVE_INPUT_FD_STAT_CHANGED";
    if(final_mount!=mount||
      final_stat.st_dev!=f->st.st_dev||final_stat.st_ino!=f->st.st_ino||final_stat.st_mode!=f->st.st_mode||
      final_stat.st_uid!=f->st.st_uid||final_stat.st_gid!=f->st.st_gid||final_stat.st_rdev!=f->st.st_rdev){fd_ok=false;break;}
  }close(fd_dir);close(info_dir);if(!fd_ok)return;s->fd_count=fd_count;
  work->error="DECODER_NATIVE_INPUT_TASK_REENUMERATE";
  if(!worker_numbers(w,w->proc_fd,"task",again,WORKER_TASKS,&count_again))return;
  work->error="DECODER_NATIVE_INPUT_TASK_SET_CHANGED";
  if(count!=count_again||memcmp(numbers,again,count*sizeof(int)))return;
  work->error="DECODER_NATIVE_INPUT_FD_REENUMERATE";
  if(!worker_numbers(w,w->proc_fd,"fd",fds_again,WORKER_FDS,&fd_count_again))return;
  work->error="DECODER_NATIVE_INPUT_FD_SET_CHANGED";
  if(fd_count!=fd_count_again||memcmp(fds,fds_again,fd_count*sizeof(int)))return;
  work->error="DECODER_NATIVE_INPUT_IDENTITY_FINAL";
  if(!worker_identity(w))return;
  char final_exe[512];work->error="DECODER_NATIVE_INPUT_EXECUTABLE_REREAD";
  if(!worker_link(w,w->proc_fd,"exe",final_exe,sizeof(final_exe)))return;
  work->error="DECODER_NATIVE_INPUT_EXECUTABLE_CHANGED";
  if(strcmp(final_exe,s->executable))return;
  work->error=NULL;
}
static napi_status worker_string(napi_env env,napi_value object,const char *name,const char *text){napi_value value;napi_status s=napi_create_string_utf8(env,text,NAPI_AUTO_LENGTH,&value);return s==napi_ok?napi_set_named_property(env,object,name,value):s;}
static napi_status worker_number(napi_env env,napi_value object,const char *name,double number){napi_value value;napi_status s=napi_create_double(env,number,&value);return s==napi_ok?napi_set_named_property(env,object,name,value):s;}
static napi_status worker_bool(napi_env env,napi_value object,const char *name,bool boolean){napi_value value;napi_status s=napi_get_boolean(env,boolean,&value);return s==napi_ok?napi_set_named_property(env,object,name,value):s;}
static napi_status worker_ns_object(napi_env env,char ns[WORKER_NS][64],napi_value *result){napi_status s=napi_create_object(env,result);if(s!=napi_ok)return s;for(size_t i=0;i<WORKER_NS;i++){s=worker_string(env,*result,worker_ns_names[i],ns[i]);if(s!=napi_ok)return s;}return napi_ok;}
static bool worker_js_snapshot(napi_env env,worker_record *w,napi_value *out) {
  worker_snapshot *s=w->snapshot;napi_value value,rows,row,ns;char number[32];
#define W(call) do{if((call)!=napi_ok)return false;}while(0)
  W(napi_create_object(env,out));W(worker_string(env,*out,"executable",s->executable));W(napi_create_string_utf8(env,s->command,s->command_size,&value));W(napi_set_named_property(env,*out,"command",value));
  W(worker_string(env,*out,"mountinfo",s->mounts));W(worker_string(env,*out,"limits",s->limits));W(worker_string(env,*out,"network",s->network));W(worker_ns_object(env,s->host_ns,&ns));W(napi_set_named_property(env,*out,"hostNamespaces",ns));
  W(napi_create_object(env,&value));for(size_t i=0;i<7;i++)W(worker_string(env,value,worker_resources[i],s->resources[i]));W(napi_set_named_property(env,*out,"resources",value));
  W(napi_create_array_with_length(env,s->task_count,&rows));for(size_t i=0;i<s->task_count;i++){worker_task *t=&s->tasks[i];W(napi_create_object(env,&row));W(worker_number(env,row,"tid",t->tid));W(worker_string(env,row,"status",t->status));W(worker_string(env,row,"apparmor",t->apparmor));W(worker_ns_object(env,t->ns,&ns));W(napi_set_named_property(env,row,"namespaces",ns));W(napi_set_element(env,rows,(uint32_t)i,row));}W(napi_set_named_property(env,*out,"tasks",rows));
  W(napi_create_array_with_length(env,s->fd_count,&rows));for(size_t i=0;i<s->fd_count;i++){worker_fd *f=&s->fds[i];W(napi_create_object(env,&row));W(worker_number(env,row,"number",f->number));W(worker_string(env,row,"target",f->target));W(worker_string(env,row,"info",f->info));W(worker_number(env,row,"mode",f->st.st_mode));W(worker_number(env,row,"uid",f->st.st_uid));W(worker_number(env,row,"gid",f->st.st_gid));snprintf(number,sizeof(number),"%llu",(unsigned long long)f->st.st_dev);W(worker_string(env,row,"device",number));snprintf(number,sizeof(number),"%llu",(unsigned long long)f->st.st_ino);W(worker_string(env,row,"inode",number));snprintf(number,sizeof(number),"%llu",(unsigned long long)f->mount_id);W(worker_string(env,row,"mountId",number));W(worker_bool(env,row,"rootMatches",f->root_match));W(napi_set_element(env,rows,(uint32_t)i,row));}W(napi_set_named_property(env,*out,"fds",rows));
#undef W
  return true;
}
static void complete_worker(napi_env env,napi_status status,void *data) {
  worker_work *work=data;worker_record *w=work->record;napi_value result,handle,snapshot,error,code;
  const char *failure=work->error;bool wrapped=false;
  if(status!=napi_ok)failure="DECODER_NATIVE_INPUT_ASYNC";
  if(!failure&&!worker_identity(w))failure="DECODER_NATIVE_INPUT_STALE";
  if(!failure&&(napi_create_object(env,&result)!=napi_ok||napi_create_object(env,&handle)!=napi_ok||!worker_js_snapshot(env,w,&snapshot)||
    napi_type_tag_object(env,handle,&worker_tag)!=napi_ok))failure="DECODER_NATIVE_API";
  if(!failure){if(napi_wrap(env,handle,w,finalize_worker,NULL,NULL)!=napi_ok)failure="DECODER_NATIVE_API";else wrapped=true;}
  if(!failure&&(napi_set_named_property(env,result,"handle",handle)!=napi_ok||napi_set_named_property(env,result,"snapshot",snapshot)!=napi_ok))failure="DECODER_NATIVE_API";
  if(failure){if(napi_create_string_utf8(env,failure,NAPI_AUTO_LENGTH,&code)==napi_ok&&napi_create_error(env,code,code,&error)==napi_ok)napi_reject_deferred(env,work->deferred,error);release_worker(w);if(!wrapped)free(w);}
  else napi_resolve_deferred(env,work->deferred,result);
  napi_delete_async_work(env,work->work);free(work);
}
static napi_value capture_worker(napi_env env,napi_callback_info info) {
  size_t argc=5,length=0;napi_value args[5],promise,name;double pid;uint64_t deadline;bool lossless=false;
  NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));if(argc!=4||geteuid()!=0)return fail(env,"DECODER_NATIVE_INPUT_ARGUMENT");
  group_record *group=get_group(env,args[0]);if(!group)return NULL;
  if(napi_get_value_double(env,args[1],&pid)!=napi_ok||!(pid>1&&pid<=INT_MAX)||pid!=(int)pid||napi_get_value_bigint_uint64(env,args[3],&deadline,&lossless)!=napi_ok||!lossless||
    napi_get_value_string_utf8(env,args[2],NULL,0,&length)!=napi_ok||length!=64)return fail(env,"DECODER_NATIVE_INPUT_ARGUMENT");
  if(atomic_fetch_add(&active_workers,1)>=1){atomic_fetch_sub(&active_workers,1);return fail(env,"DECODER_NATIVE_INPUT_CAPACITY");}
  worker_record *w=calloc(1,sizeof(*w));worker_work *work=calloc(1,sizeof(*work));
  if(!w||!work){free(w);free(work);atomic_fetch_sub(&active_workers,1);return fail(env,"DECODER_NATIVE_MEMORY");}
  w->counted=true;w->pid_fd=w->proc_fd=w->scope_fd=-1;w->group.root_fd=w->group.group_fd=w->group.events_fd=w->group.freeze_fd=w->group.kill_fd=-1;
  w->pid=(int)pid;w->deadline=deadline;w->snapshot=calloc(1,sizeof(*w->snapshot));
  if(!w->snapshot||napi_get_value_string_utf8(env,args[2],w->id,sizeof(w->id),&length)!=napi_ok||length!=64)goto refused;
  for(size_t i=0;i<64;i++)if(!((w->id[i]>='a'&&w->id[i]<='f')||(w->id[i]>='0'&&w->id[i]<='9')))goto refused;
  bool p=false,r=false,f=false;if(group->quarantined||!group_observation(group,&p,&r,&f)||!p||r||f)goto refused;
  w->group.root_device=group->root_device;w->group.root_inode=group->root_inode;w->group.device=group->device;w->group.inode=group->inode;
  w->group.root_fd=fcntl(group->root_fd,F_DUPFD_CLOEXEC,3);w->group.group_fd=fcntl(group->group_fd,F_DUPFD_CLOEXEC,3);
  w->group.events_fd=group_file(w->group.group_fd,"cgroup.events",O_RDONLY);w->group.freeze_fd=group_file(w->group.group_fd,"cgroup.freeze",O_RDONLY);
  if(w->group.root_fd<0||w->group.group_fd<0||w->group.events_fd<0||w->group.freeze_fd<0)goto refused;
  w->pid_fd=(int)syscall(SYS_pidfd_open,w->pid,0);if(w->pid_fd<0)goto refused;
  int proc=open("/proc",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);struct statfs fs;char pid_name[32];snprintf(pid_name,sizeof(pid_name),"%d",w->pid);
  if(proc<0)goto refused;
  if(fstatfs(proc,&fs)<0||(unsigned long)fs.f_type!=(unsigned long)PROC_SUPER_MAGIC){close(proc);goto refused;}
  w->proc_fd=worker_directory(proc,pid_name);close(proc);if(w->proc_fd<0)goto refused;
  snprintf(w->scope,sizeof(w->scope),"docker-%s.scope",w->id);w->scope_fd=protected_dir(w->group.group_fd,w->scope);struct stat st;
  if(w->scope_fd<0||fstat(w->scope_fd,&st)<0)goto refused;
  w->scope_device=st.st_dev;w->scope_inode=st.st_ino;
  if(fstat(w->proc_fd,&st)<0)goto refused;
  w->proc_device=st.st_dev;w->proc_inode=st.st_ino;if(!worker_identity(w))goto refused;
  work->record=w;
  if(napi_create_promise(env,&work->deferred,&promise)!=napi_ok||napi_create_string_utf8(env,"atlas-worker-input",NAPI_AUTO_LENGTH,&name)!=napi_ok||
    napi_create_async_work(env,NULL,name,execute_worker,complete_worker,work,&work->work)!=napi_ok)goto refused;
  if(napi_queue_async_work(env,work->work)!=napi_ok){napi_delete_async_work(env,work->work);goto refused;}
  return promise;
 refused:release_worker(w);free(w);free(work);return fail(env,"DECODER_NATIVE_INPUT_CAPTURE");
}
static napi_value inspect_worker(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2],result;NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));if(argc!=1)return fail(env,"DECODER_NATIVE_INPUT_HANDLE");worker_record *w=get_worker(env,args[0]);if(!w)return NULL;
  bool ok=worker_identity(w);char executable[512],ns[WORKER_NS][64];
  if(ok)ok=worker_link(w,w->proc_fd,"exe",executable,sizeof(executable))&&strcmp(executable,w->snapshot->executable)==0&&worker_namespaces(w,w->proc_fd,ns);
  if(ok){worker_task *leader=NULL;for(size_t i=0;i<w->snapshot->task_count;i++)if(w->snapshot->tasks[i].tid==w->pid)leader=&w->snapshot->tasks[i];ok=leader!=NULL;if(leader)for(size_t i=0;i<WORKER_NS;i++)if(strcmp(ns[i],leader->ns[i])!=0)ok=false;}
  NAPI(napi_get_boolean(env,ok,&result));return result;
}
static napi_value close_worker(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2],result;NAPI(napi_get_cb_info(env,info,&argc,args,NULL,NULL));if(argc!=1)return fail(env,"DECODER_NATIVE_INPUT_HANDLE");worker_record *w=get_worker(env,args[0]);if(!w)return NULL;release_worker(w);NAPI(napi_get_undefined(env,&result));return result;
}

static napi_value initialize(napi_env env,napi_value exports) {
  napi_property_descriptor methods[]={
    {"capture",NULL,capture,NULL,NULL,NULL,napi_default,NULL},
    {"inspect",NULL,inspect,NULL,NULL,NULL,napi_default,NULL},
    {"close",NULL,close_peer,NULL,NULL,NULL,napi_default,NULL},
    {"boottimeNanoseconds",NULL,boottime,NULL,NULL,NULL,napi_default,NULL},
    {"captureGroup",NULL,capture_group,NULL,NULL,NULL,napi_default,NULL},
    {"captureRecoveryLock",NULL,capture_recovery_lock,NULL,NULL,NULL,napi_default,NULL},
    {"inspectRecoveryLock",NULL,inspect_recovery_lock,NULL,NULL,NULL,napi_default,NULL},
    {"groupStatus",NULL,group_status,NULL,NULL,NULL,napi_default,NULL},
    {"freezeAndKillGroup",NULL,freeze_kill_group,NULL,NULL,NULL,napi_default,NULL},
    {"closeGroup",NULL,close_group,NULL,NULL,NULL,napi_default,NULL},
    {"assertGroupMember",NULL,assert_group_member,NULL,NULL,NULL,napi_default,NULL},
    {"notifySupervisor",NULL,notify_supervisor,NULL,NULL,NULL,napi_default,NULL},
    {"captureWorkerControls",NULL,capture_worker,NULL,NULL,NULL,napi_default,NULL},
    {"inspectWorkerBarrier",NULL,inspect_worker,NULL,NULL,NULL,napi_default,NULL},
    {"closeWorkerBarrier",NULL,close_worker,NULL,NULL,NULL,napi_default,NULL}
  };
  NAPI(napi_define_properties(env,exports,sizeof(methods)/sizeof(methods[0]),methods));return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
