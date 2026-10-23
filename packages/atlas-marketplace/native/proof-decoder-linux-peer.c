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
static napi_value initialize(napi_env env,napi_value exports) {
  napi_property_descriptor methods[]={
    {"capture",NULL,capture,NULL,NULL,NULL,napi_default,NULL},
    {"inspect",NULL,inspect,NULL,NULL,NULL,napi_default,NULL},
    {"close",NULL,close_peer,NULL,NULL,NULL,napi_default,NULL},
    {"boottimeNanoseconds",NULL,boottime,NULL,NULL,NULL,napi_default,NULL}
  };
  NAPI(napi_define_properties(env,exports,sizeof(methods)/sizeof(methods[0]),methods));return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
