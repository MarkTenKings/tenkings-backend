// Independent fixture oracle: ask pinned libheif for its normal primary-image
// presentation directly. No ATLAS addon, property parser, PNG writer, crop or
// orientation matrix is used. Input/output paths are isolated fixture files.
#include <libheif/heif.h>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <vector>
#include <string>
#include <stdexcept>
static void check(heif_error error) { if (error.code != heif_error_Ok) throw std::runtime_error(error.message); }
int main(int argc, char** argv) {
 try {
  if (argc != 3 || std::string(heif_get_version()) != "1.23.2") throw std::runtime_error("oracle input/version");
  std::ifstream file(argv[1],std::ios::binary|std::ios::ate);
  const auto size=file.tellg(); if(size<=0||size>268435456) throw std::runtime_error("oracle input size");
  std::vector<char> bytes(static_cast<size_t>(size)); file.seekg(0); file.read(bytes.data(),size);
  auto* context=heif_context_alloc(); heif_context_set_max_decoding_threads(context,1);
  check(heif_context_read_from_memory_without_copy(context,bytes.data(),bytes.size(),nullptr));
  heif_image_handle* handle=nullptr; check(heif_context_get_primary_image_handle(context,&handle));
  auto* options=heif_decoding_options_alloc();
  options->decoder_id="libde265"; options->strict_decoding=1;
  options->num_codec_threads=1;options->num_library_threads=1;
  // Keep the library's normal presentation (ignore_transformations remains 0).
  options->output_image_nclx_profile_passthrough=1;
  heif_image* image=nullptr;check(heif_decode_image(handle,&image,heif_colorspace_RGB,heif_chroma_interleaved_RGB,options));
  const int width=heif_image_get_width(image,heif_channel_interleaved),height=heif_image_get_height(image,heif_channel_interleaved);
  if(width<2||height<2||static_cast<long long>(width)*height>52000000||heif_image_get_bits_per_pixel_range(image,heif_channel_interleaved)!=8)throw std::runtime_error("oracle raster");
  size_t stride=0; const auto* pixels=heif_image_get_plane_readonly2(image,heif_channel_interleaved,&stride);
  if(!pixels||stride<static_cast<size_t>(width)*3||heif_image_get_decoding_warnings(image,0,nullptr,0))throw std::runtime_error("oracle decode");
  std::ofstream output(argv[2],std::ios::binary);for(int y=0;y<height;y++)output.write(reinterpret_cast<const char*>(pixels+y*stride),width*3);
  output.close();if(!output)throw std::runtime_error("oracle output");
  std::printf("{\"width\":%d,\"height\":%d,\"channels\":3,\"bitDepth\":8,\"libheif\":\"%s\"}\n",width,height,heif_get_version());
  heif_image_release(image);heif_decoding_options_free(options);heif_image_handle_release(handle);heif_context_free(context);
  return 0;
 }catch(const std::exception& e){std::fprintf(stderr,"%s\n",e.what());return 1;}
}
