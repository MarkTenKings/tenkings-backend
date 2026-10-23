#define _GNU_SOURCE
/* PROBE_ONLY: finite hostile-control source, never a decoder or authority.
 * Build/run only in the separately pinned probe image under the real guard.
 * No external command, user path, environment, arbitrary syscall or retry API. */
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <linux/bpf.h>
#include <linux/capability.h>
#include <linux/io_uring.h>
#include <linux/keyctl.h>
#include <poll.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/mount.h>
#include <sys/ptrace.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#define FRAME_BYTES 48U
#define RECORD_BYTES 4096U
#define OUTPUT_BYTES 8192U
#define OBSERVATIONS_MAX 24U
#define INPUT_OUTPUT_NS UINT64_C(1000000000)
#define ORDINARY_BUDGET_NS UINT64_C(5000000000)
#define CPU_QUOTA_NS UINT64_C(2000000000)
#define CPU_DEADLINE_NS UINT64_C(20000000000)
#define THREADS_MAX 40U
#define FD_ATTEMPTS_MAX 80U
#define REGION_BYTES (8U * 1024U * 1024U)
#define REGIONS_MAX 80U
#define TMP_WRITE_MAX (9U * 1024U * 1024U)
#define NODE_PATH "/opt/atlas-proof-decoder/bin/node"
#define WORKER_PATH "/opt/atlas-proof-decoder/worker.mjs"
#define SCHEMA "atlas-proof-decoder-control-probe-v1"

static const char *const modes[] = {NULL,"NETWORK","PRIVILEGE","READONLY","TMPFS","PIDS","FD","MEMORY_OOM","CPU_QUOTA","CPU_DEADLINE"};
struct observation { const char *id; int64_t value; int error; };
struct context {
  unsigned mode, count;
  char nonce[65];
  uint64_t started, deadline, last_clock;
  const char *reason;
  struct observation observations[OBSERVATIONS_MAX];
};
static size_t written_total;
static bool boot(uint64_t *out) {
  struct timespec ts;
  if (clock_gettime(CLOCK_BOOTTIME,&ts)!=0 || ts.tv_sec<0 || ts.tv_nsec<0 || ts.tv_nsec>=1000000000L) return false;
  if ((uint64_t)ts.tv_sec>UINT64_MAX/UINT64_C(1000000000)) return false;
  *out=(uint64_t)ts.tv_sec*UINT64_C(1000000000)+(uint64_t)ts.tv_nsec;
  return true;
}
static bool remaining(uint64_t deadline,int *milliseconds) {
  uint64_t now;
  if (!boot(&now) || now>=deadline) return false;
  uint64_t ms=(deadline-now+UINT64_C(999999))/UINT64_C(1000000);
  *milliseconds=(int)(ms>1000U?1000U:ms);
  return true;
}
static bool wait_fd(int fd,short events,uint64_t deadline) {
  for (;;) {
    int timeout;
    if (!remaining(deadline,&timeout)) return false;
    struct pollfd item={.fd=fd,.events=events,.revents=0};
    int ready=poll(&item,1,timeout);
    if (ready<0 && errno==EINTR) continue;
    if (ready<=0 || (item.revents&(POLLERR|POLLNVAL))) return false;
    if (item.revents&(events|POLLHUP)) return true;
  }
}
static bool nonblocking(int fd) {
  int flags=fcntl(fd,F_GETFL);
  return flags>=0 && fcntl(fd,F_SETFL,flags|O_NONBLOCK)==0;
}
static bool frame(unsigned *mode,char nonce[65]) {
  uint64_t now;
  if (!boot(&now) || now>UINT64_MAX-INPUT_OUTPUT_NS) return false;
  uint64_t deadline=now+INPUT_OUTPUT_NS;
  unsigned char bytes[FRAME_BYTES+1U]={0}; size_t used=0;
  for (;;) {
    if (!wait_fd(STDIN_FILENO,POLLIN,deadline)) return false;
    ssize_t got=read(STDIN_FILENO,bytes+used,sizeof(bytes)-used);
    if (got<0 && (errno==EINTR || errno==EAGAIN)) continue;
    if (got<0) return false;
    if (got==0) break;
    used+=(size_t)got;
    if (used>FRAME_BYTES) return false;
  }
  if (used!=FRAME_BYTES || memcmp(bytes,"ATR2P001",8U)!=0 || bytes[8]<1U || bytes[8]>9U) return false;
  for (size_t i=9U;i<16U;i++) if (bytes[i]!=0U) return false;
  static const char hex[]="0123456789abcdef";
  for (size_t i=0;i<32U;i++) { nonce[i*2U]=hex[bytes[16U+i]>>4U];nonce[i*2U+1U]=hex[bytes[16U+i]&15U]; }
  nonce[64]='\0';*mode=bytes[8];memset(bytes,0,sizeof(bytes));return true;
}
static bool output(const char *bytes,size_t length) {
  uint64_t now;
  if (length==0U || length>RECORD_BYTES || written_total>OUTPUT_BYTES-length || !boot(&now) || now>UINT64_MAX-INPUT_OUTPUT_NS) return false;
  uint64_t deadline=now+INPUT_OUTPUT_NS;size_t at=0;
  while (at<length) {
    if (!wait_fd(STDOUT_FILENO,POLLOUT,deadline)) return false;
    ssize_t wrote=write(STDOUT_FILENO,bytes+at,length-at);
    if (wrote<0 && (errno==EINTR || errno==EAGAIN)) continue;
    if (wrote<=0) return false;
    at+=(size_t)wrote;written_total+=(size_t)wrote;
  }
  return true;
}
struct text { char data[RECORD_BYTES];size_t used;bool valid; };
static void append(struct text *text,const char *format,...) {
  if (!text->valid) return;
  va_list args;va_start(args,format);
  int count=vsnprintf(text->data+text->used,sizeof(text->data)-text->used,format,args);
  va_end(args);
  if (count<0 || (size_t)count>=sizeof(text->data)-text->used) {text->valid=false;return;}
  text->used+=(size_t)count;
}
static bool emit(const struct context *ctx,bool final) {
  struct text text={.used=0,.valid=true};
  append(&text,"{\"schema\":\"" SCHEMA "\",\"classification\":\"UNVERIFIED\",\"evidenceKind\":\"PROBE_ONLY\",\"executionAllowed\":false,\"freshPublicationAllowed\":false,\"runtimeQualified\":false,\"stage\":\"%s\",\"mode\":\"%s\",\"nonce\":\"%s\",\"pid\":%ld,\"startedBootNs\":\"%" PRIu64 "\"",final?"FINAL":"BEGIN",modes[ctx->mode],ctx->nonce,(long)getpid(),ctx->started);
  if (final) {
    uint64_t finished;
    if (!boot(&finished) || finished<ctx->last_clock) return false;
    append(&text,",\"finishedBootNs\":\"%" PRIu64 "\",\"completion\":\"%s\",\"reason\":\"%s\",\"observations\":[",finished,ctx->reason==NULL?"COMPLETE":"STOPPED",ctx->reason==NULL?"NORMAL":ctx->reason);
    for (unsigned i=0;i<ctx->count;i++) append(&text,"%s{\"id\":\"%s\",\"value\":%" PRId64 ",\"error\":%d}",i==0U?"":",",ctx->observations[i].id,ctx->observations[i].value,ctx->observations[i].error);
    append(&text,"]");
  }
  append(&text,"}\n");return text.valid && output(text.data,text.used);
}
static void record(struct context *ctx,const char *id,int64_t value,int error) {
  if (ctx->count>=OBSERVATIONS_MAX || error<0 || error>4095) {ctx->reason="INTERNAL_ERROR";return;}
  ctx->observations[ctx->count++]=(struct observation){.id=id,.value=value,.error=error};
}
static bool budget(struct context *ctx) {
  uint64_t now;
  if (ctx->reason!=NULL) return false;
  if (!boot(&now) || now<ctx->last_clock) {ctx->reason="CLOCK_ERROR";return false;}
  ctx->last_clock=now;
  if (now>=ctx->deadline) {ctx->reason="BUDGET";return false;}
  return true;
}
static void nap(void) { struct timespec delay={.tv_sec=0,.tv_nsec=1000000L};(void)nanosleep(&delay,NULL); }
static bool expect_denied(struct context *ctx,const char *id,long result,int error) {
  record(ctx,id,result<0?-1:0,result<0?error:0);
  if (result>=0) {ctx->reason="UNEXPECTED_SUCCESS";return false;}
  return budget(ctx);
}
static void network_probe(struct context *ctx) {
  static const struct {const char *id;int family,type,protocol;} cases[]={
    {"SOCKET_INET",AF_INET,SOCK_STREAM,0},{"SOCKET_INET6",AF_INET6,SOCK_STREAM,0},{"SOCKET_INET_RAW",AF_INET,SOCK_RAW,1},{"SOCKET_INET6_RAW",AF_INET6,SOCK_RAW,58},{"SOCKET_UNIX",AF_UNIX,SOCK_STREAM,0},
    {"SOCKET_PACKET",AF_PACKET,SOCK_RAW,0},{"SOCKET_ALG",AF_ALG,SOCK_SEQPACKET,0},{"SOCKET_VSOCK",AF_VSOCK,SOCK_STREAM,0},{"SOCKET_NETLINK",AF_NETLINK,SOCK_RAW,0}
  };
  for (size_t i=0;i<sizeof(cases)/sizeof(cases[0]) && budget(ctx);i++) {
    errno=0;long result=syscall(SYS_socket,cases[i].family,cases[i].type|SOCK_CLOEXEC,cases[i].protocol);int error=errno;
    if (result>=0) (void)close((int)result);
    if (!expect_denied(ctx,cases[i].id,result,error)) return;
  }
}
static void privilege_probe(struct context *ctx) {
  record(ctx,"UID",(int64_t)getuid(),0);record(ctx,"EUID",(int64_t)geteuid(),0);record(ctx,"GID",(int64_t)getgid(),0);record(ctx,"EGID",(int64_t)getegid(),0);
  errno=0;long result=syscall(SYS_prctl,39,0,0,0,0);int error=errno;record(ctx,"NO_NEW_PRIVS",result,result<0?error:0);
  errno=0;result=syscall(SYS_prctl,21,0,0,0,0);error=errno;record(ctx,"SECCOMP_MODE",result,result<0?error:0);
#define DENY_CALL(id, expression) do { if (!budget(ctx)) return;errno=0;long rc=(expression);int err=errno;if (!expect_denied(ctx,(id),rc,err)) return; } while (0)
  DENY_CALL("SETUID_ROOT",syscall(SYS_setuid,0));
  DENY_CALL("SETGID_ROOT",syscall(SYS_setgid,0));
  struct __user_cap_header_struct header={.version=_LINUX_CAPABILITY_VERSION_3,.pid=0};
  struct __user_cap_data_struct caps[2]={{.effective=1U<<CAP_SYS_ADMIN,.permitted=1U<<CAP_SYS_ADMIN,.inheritable=0},{0}};
  DENY_CALL("CAPSET_ADMIN",syscall(SYS_capset,&header,caps));
  DENY_CALL("UNSHARE_USER",syscall(SYS_unshare,CLONE_NEWUSER));
  DENY_CALL("UNSHARE_MOUNT",syscall(SYS_unshare,CLONE_NEWNS));
  DENY_CALL("MOUNT_TMPFS",syscall(SYS_mount,"tmpfs","/tmp","tmpfs",MS_NODEV|MS_NOSUID|MS_NOEXEC,"size=4096"));
  DENY_CALL("PTRACE_TRACEME",syscall(SYS_ptrace,PTRACE_TRACEME,0,NULL,NULL));
  union bpf_attr attr;memset(&attr,0,sizeof(attr));attr.map_type=BPF_MAP_TYPE_ARRAY;attr.key_size=4;attr.value_size=4;attr.max_entries=1;
  if (!budget(ctx)) return;
  errno=0;result=syscall(SYS_bpf,BPF_MAP_CREATE,&attr,sizeof(attr));error=errno;if (result>=0) (void)close((int)result);
  if (!expect_denied(ctx,"BPF_MAP",result,error)) return;
  errno=0;result=syscall(SYS_userfaultfd,O_CLOEXEC|O_NONBLOCK);error=errno;if (result>=0) (void)close((int)result);
  if (!expect_denied(ctx,"USERFAULTFD",result,error)) return;
  struct io_uring_params ring;memset(&ring,0,sizeof(ring));
  errno=0;result=syscall(SYS_io_uring_setup,1U,&ring);error=errno;if (result>=0) (void)close((int)result);
  if (!expect_denied(ctx,"IO_URING",result,error)) return;
  DENY_CALL("KEYCTL_ID",syscall(SYS_keyctl,KEYCTL_GET_KEYRING_ID,KEY_SPEC_THREAD_KEYRING,0));
#undef DENY_CALL
}
static void readonly_probe(struct context *ctx) {
  static const char *const paths[]={NODE_PATH,WORKER_PATH};
  static const char *const ids[]={"OPEN_NODE_WRITE","OPEN_WORKER_WRITE"};
  for (unsigned i=0;i<2U && budget(ctx);i++) {
    errno=0;int fd=open(paths[i],O_WRONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);int error=errno;
    if (fd>=0) (void)close(fd); /* Never write, truncate, rename or chmod image code. */
    if (!expect_denied(ctx,ids[i],fd,error)) return;
  }
}
static void temporary_one(struct context *ctx,const char *path,const char *create_id,const char *write_id,const char *map_id,const char *unlink_id) {
  if (!budget(ctx)) return;
  errno=0;int fd=open(path,O_RDWR|O_CLOEXEC|O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK,0600);int error=errno;record(ctx,create_id,fd<0?-1:0,fd<0?error:0);
  if (fd<0) {ctx->reason="SYSCALL_ERROR";return;}
  struct stat owned,current;bool valid=fstat(fd,&owned)==0 && S_ISREG(owned.st_mode) && owned.st_uid==65532U && owned.st_nlink==1 && (owned.st_mode&0777U)==0600U;
  if (!valid) {ctx->reason="OWNERSHIP_ERROR";(void)close(fd);return;}
  unsigned char block[65536];memset(block,0xa5,sizeof(block));size_t count=0;error=0;
  while (count<TMP_WRITE_MAX && budget(ctx)) {
    size_t length=TMP_WRITE_MAX-count;if (length>sizeof(block)) length=sizeof(block);
    ssize_t wrote=write(fd,block,length);if (wrote<0 && errno==EINTR) continue;
    if (wrote<=0) {error=wrote<0?errno:EIO;break;}count+=(size_t)wrote;
  }
  record(ctx,write_id,(int64_t)count,error);
  if (count==TMP_WRITE_MAX) ctx->reason="LIMIT_NOT_REACHED";
  if (ctx->reason==NULL) {
    errno=0;void *mapped=mmap(NULL,4096U,PROT_READ|PROT_EXEC,MAP_PRIVATE,fd,0);error=errno;
    record(ctx,map_id,mapped==MAP_FAILED?-1:0,mapped==MAP_FAILED?error:0);
    if (mapped!=MAP_FAILED) {(void)munmap(mapped,4096U);ctx->reason="UNEXPECTED_SUCCESS";}
  }
  /* Delete only this invocation's exact fresh regular inode; no stale cleanup. */
  if (fstatat(AT_FDCWD,path,&current,AT_SYMLINK_NOFOLLOW)==0 && current.st_dev==owned.st_dev && current.st_ino==owned.st_ino && current.st_nlink==1 && S_ISREG(current.st_mode)) {
    errno=0;int removed=unlink(path);error=errno;record(ctx,unlink_id,removed,removed<0?error:0);if (removed!=0 && ctx->reason==NULL) ctx->reason="SYSCALL_ERROR";
  } else ctx->reason="OWNERSHIP_ERROR";
  if (close(fd)!=0 && ctx->reason==NULL) ctx->reason="SYSCALL_ERROR";
}
static void temporary_probe(struct context *ctx) {
  temporary_one(ctx,"/tmp/atlas-r2-control-probe.tmp","TMP_CREATE","TMP_WRITTEN","TMP_EXEC_MAP","TMP_UNLINK");
  if (ctx->reason==NULL) temporary_one(ctx,"/dev/shm/atlas-r2-control-probe.shm","SHM_CREATE","SHM_WRITTEN","SHM_EXEC_MAP","SHM_UNLINK");
}
struct threads { atomic_bool stop; bool busy; };
static void *thread_body(void *opaque) {
  struct threads *state=opaque;volatile uint64_t number=UINT64_C(0x9e3779b97f4a7c15);
  while (!atomic_load_explicit(&state->stop,memory_order_relaxed)) {
    if (state->busy) {for (unsigned i=0;i<4096U;i++) number=number*UINT64_C(6364136223846793005)+UINT64_C(1442695040888963407);}
    else nap();
  }
  return NULL;
}
static void threads_probe(struct context *ctx,bool cpu) {
  pthread_t workers[THREADS_MAX];struct threads state={.stop=ATOMIC_VAR_INIT(false),.busy=cpu};
  unsigned limit=cpu?4U:THREADS_MAX,created=0,joined=0;int error=0;
  struct timespec cpu_start={0},cpu_end={0};bool cpu_clock=clock_gettime(CLOCK_PROCESS_CPUTIME_ID,&cpu_start)==0;
  for (;created<limit && budget(ctx);created++) {error=pthread_create(&workers[created],NULL,thread_body,&state);if (error!=0) break;}
  record(ctx,"THREADS_CREATED",(int64_t)created,error);
  if (!cpu && created==THREADS_MAX) ctx->reason="LIMIT_NOT_REACHED";
  if (cpu && created!=4U && ctx->reason==NULL) ctx->reason="SYSCALL_ERROR";
  uint64_t hold=ctx->started+(cpu?(ctx->mode==9U?CPU_DEADLINE_NS:CPU_QUOTA_NS):UINT64_C(750000000));
  while (budget(ctx) && ctx->last_clock<hold) nap();
  /* Reaching the deliberate deadline-mode local bound is not a guard success. */
  if (ctx->mode==9U && ctx->reason!=NULL && strcmp(ctx->reason,"BUDGET")==0) ctx->reason="LIMIT_NOT_REACHED";
  atomic_store_explicit(&state.stop,true,memory_order_relaxed);int join_error=0;
  for (unsigned i=0;i<created;i++) {int result=pthread_join(workers[i],NULL);if (result==0) joined++;else if (join_error==0) join_error=result;}
  record(ctx,"THREADS_JOINED",(int64_t)joined,join_error);if (join_error!=0 && ctx->reason==NULL) ctx->reason="SYSCALL_ERROR";
  if (cpu) {
    if (cpu_clock && clock_gettime(CLOCK_PROCESS_CPUTIME_ID,&cpu_end)==0) {
      int64_t elapsed=(int64_t)(cpu_end.tv_sec-cpu_start.tv_sec)*INT64_C(1000000000)+(int64_t)(cpu_end.tv_nsec-cpu_start.tv_nsec);
      if (elapsed>=0 && elapsed<=INT64_C(1000000000000)) record(ctx,"CPU_ELAPSED_NS",elapsed,0);else {record(ctx,"CPU_ELAPSED_NS",-1,EIO);ctx->reason="CLOCK_ERROR";}
    } else {record(ctx,"CPU_ELAPSED_NS",-1,EIO);ctx->reason="CLOCK_ERROR";}
  }
}
static void fd_probe(struct context *ctx) {
  struct rlimit limit;
  if (getrlimit(RLIMIT_NOFILE,&limit)!=0) {ctx->reason="SYSCALL_ERROR";return;}
  record(ctx,"NOFILE_SOFT",limit.rlim_cur==RLIM_INFINITY?-1:(int64_t)limit.rlim_cur,0);record(ctx,"NOFILE_HARD",limit.rlim_max==RLIM_INFINITY?-1:(int64_t)limit.rlim_max,0);
  int fds[FD_ATTEMPTS_MAX];unsigned count=0,closed=0;int error=0;
  for (;count<FD_ATTEMPTS_MAX && budget(ctx);count++) {fds[count]=open("/dev/null",O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if (fds[count]<0) {error=errno;break;}}
  record(ctx,"FD_OPENED",(int64_t)count,error);if (count==FD_ATTEMPTS_MAX) ctx->reason="LIMIT_NOT_REACHED";
  int close_error=0;for (unsigned i=0;i<count;i++) {if (close(fds[i])==0) closed++;else if (close_error==0) close_error=errno;}
  record(ctx,"FD_CLOSED",(int64_t)closed,close_error);if (close_error!=0 && ctx->reason==NULL) ctx->reason="SYSCALL_ERROR";
}
static void memory_probe(struct context *ctx) {
  void *regions[REGIONS_MAX];unsigned count=0,released=0;uint64_t touched=0;int error=0;
  for (;count<REGIONS_MAX && budget(ctx);count++) {
    regions[count]=mmap(NULL,REGION_BYTES,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    if (regions[count]==MAP_FAILED) {error=errno;break;}
    volatile unsigned char *bytes=regions[count];
    for (size_t at=0;at<REGION_BYTES;at+=4096U) {if (!budget(ctx)) break;bytes[at]=0xa5;touched+=4096U;}
    if (ctx->reason!=NULL) {count++;break;}
  }
  record(ctx,"REGIONS_CREATED",(int64_t)count,error);record(ctx,"TOUCHED_BYTES",(int64_t)touched,0);
  if (count==REGIONS_MAX && ctx->reason==NULL) ctx->reason="LIMIT_NOT_REACHED";
  if (error!=0 && ctx->reason==NULL) ctx->reason="SYSCALL_ERROR";
  int release_error=0;for (unsigned i=0;i<count;i++) {if (munmap(regions[i],REGION_BYTES)==0) released++;else if (release_error==0) release_error=errno;}
  record(ctx,"REGIONS_RELEASED",(int64_t)released,release_error);if (release_error!=0 && ctx->reason==NULL) ctx->reason="SYSCALL_ERROR";
}
int main(int argc,char **argv) {
  /* Same initial argv as the worker, but this is a distinct PROBE_ONLY ELF/image. */
  if (argc!=3 || strcmp(argv[0],NODE_PATH)!=0 || strcmp(argv[1],"--max-old-space-size=128")!=0 || strcmp(argv[2],WORKER_PATH)!=0) return 64;
  if (getuid()!=65532U || geteuid()!=65532U || getgid()!=65532U || getegid()!=65532U || syscall(SYS_prctl,39,0,0,0,0)!=1 || syscall(SYS_prctl,21,0,0,0,0)!=2) return 66;
  struct sigaction ignore;memset(&ignore,0,sizeof(ignore));ignore.sa_handler=SIG_IGN;
  if (sigemptyset(&ignore.sa_mask)!=0 || sigaction(SIGPIPE,&ignore,NULL)!=0 || !nonblocking(STDIN_FILENO) || !nonblocking(STDOUT_FILENO)) return 65;
  struct context ctx;memset(&ctx,0,sizeof(ctx));
  if (!frame(&ctx.mode,ctx.nonce) || !boot(&ctx.started) || ctx.started>UINT64_MAX-CPU_DEADLINE_NS) return 64;
  ctx.last_clock=ctx.started;ctx.deadline=ctx.started+(ctx.mode==9U?CPU_DEADLINE_NS:ORDINARY_BUDGET_NS);
  if (!emit(&ctx,false)) return 74;
  switch (ctx.mode) {
    case 1:network_probe(&ctx);break;case 2:privilege_probe(&ctx);break;case 3:readonly_probe(&ctx);break;
    case 4:temporary_probe(&ctx);break;case 5:threads_probe(&ctx,false);break;case 6:fd_probe(&ctx);break;
    case 7:memory_probe(&ctx);break;case 8:case 9:threads_probe(&ctx,true);break;default:return 64;
  }
  if (!emit(&ctx,true)) return 74;
  return ctx.reason==NULL?0:2;
}
