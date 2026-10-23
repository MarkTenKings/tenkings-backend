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
static napi_value initialize(napi_env env,napi_value exports) {
  napi_property_descriptor methods[]={
    {"capture",NULL,capture,NULL,NULL,NULL,napi_default,NULL},
    {"inspect",NULL,inspect,NULL,NULL,NULL,napi_default,NULL},
    {"close",NULL,close_peer,NULL,NULL,NULL,napi_default,NULL},
    {"boottimeNanoseconds",NULL,boottime,NULL,NULL,NULL,napi_default,NULL},
    {"captureGroup",NULL,capture_group,NULL,NULL,NULL,napi_default,NULL},
    {"groupStatus",NULL,group_status,NULL,NULL,NULL,napi_default,NULL},
    {"freezeAndKillGroup",NULL,freeze_kill_group,NULL,NULL,NULL,napi_default,NULL},
    {"closeGroup",NULL,close_group,NULL,NULL,NULL,napi_default,NULL},
    {"assertGroupMember",NULL,assert_group_member,NULL,NULL,NULL,napi_default,NULL},
    {"notifySupervisor",NULL,notify_supervisor,NULL,NULL,NULL,napi_default,NULL}
  };
  NAPI(napi_define_properties(env,exports,sizeof(methods)/sizeof(methods[0]),methods));return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
