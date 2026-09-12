#include <node_api.h>
#include <libheif/heif.h>
#include <libheif/heif_items.h>
#include <libheif/heif_properties.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

// Synchronous by design: this module runs ONLY in the disposable decoder child.
// All codec threads, pointers and allocations die with that one reaped process.
static void need(bool ok, const char* code = "PHOTO_DECODE_INVALID") { if (!ok) throw std::runtime_error(code); }
static void check(heif_error e) {
  need(e.code == heif_error_Ok, e.code == heif_error_Memory_allocation_error ? "PHOTO_DECODE_LIMIT" : "PHOTO_DECODE_INVALID");
}
static void napiCheck(napi_status s) { need(s == napi_ok, "PHOTO_DECODER_PROTOCOL"); }
static napi_value object(napi_env e) { napi_value v; napiCheck(napi_create_object(e, &v)); return v; }
static void put(napi_env e, napi_value o, const char* k, napi_value v) { napiCheck(napi_set_named_property(e, o, k, v)); }
static void num(napi_env e, napi_value o, const char* k, double n) { napi_value v; napiCheck(napi_create_double(e, n, &v)); put(e,o,k,v); }
static void str(napi_env e, napi_value o, const char* k, const char* s) { napi_value v; napiCheck(napi_create_string_utf8(e,s,NAPI_AUTO_LENGTH,&v)); put(e,o,k,v); }
static napi_value buffer(napi_env e, const void* p, size_t n) { napi_value v; napiCheck(napi_create_buffer_copy(e,n,p,nullptr,&v)); return v; }
static uint64_t limit(napi_env e, napi_value o, const char* k) {
  napi_value v; double n; napiCheck(napi_get_named_property(e,o,k,&v)); napiCheck(napi_get_value_double(e,v,&n));
  need(std::isfinite(n) && n >= 1 && n <= 9007199254740991.0 && n == std::floor(n), "PHOTO_DECODE_LIMIT");
  return static_cast<uint64_t>(n);
}
template<class T, void (*Free)(T*)> using owned = std::unique_ptr<T, decltype(Free)>;

static napi_value decode(napi_env env, napi_callback_info info) {
  try {
    need(std::strcmp(heif_get_version(), "1.23.2") == 0, "PHOTO_DECODER_UNAVAILABLE");
    const heif_decoder_descriptor* descriptors[16]; const heif_decoder_descriptor* descriptor = nullptr;
    int decoderCount = heif_get_decoder_descriptors(heif_compression_HEVC, descriptors, 16);
    need(decoderCount >= 0 && decoderCount <= 16,"PHOTO_DECODER_UNAVAILABLE");
    for (int i=0; i<decoderCount; i++) {
      const char* id = heif_decoder_descriptor_get_id_name(descriptors[i]);
      if (id && std::strcmp(id,"libde265") == 0) descriptor = descriptors[i];
    }
    need(descriptor && std::strcmp(heif_decoder_descriptor_get_name(descriptor),
        "libde265 HEVC decoder, version 1.1.1") == 0, "PHOTO_DECODER_UNAVAILABLE");
    size_t argc = 2; napi_value argv[2]; void* shouldDecode;
    napiCheck(napi_get_cb_info(env,info,&argc,argv,nullptr,&shouldDecode));
    need(argc == 2); bool isBuffer; napiCheck(napi_is_buffer(env,argv[0],&isBuffer)); need(isBuffer);
    void* bytes; size_t size; napiCheck(napi_get_buffer_info(env,argv[0],&bytes,&size));
    uint64_t inputLimit = limit(env,argv[1],"maxInputBytes"), pixelsLimit = limit(env,argv[1],"maxPixels");
    uint64_t rasterLimit = limit(env,argv[1],"maxRasterBytes");
    need(size && size <= inputLimit, "PHOTO_DECODE_LIMIT");
    owned<heif_context,heif_context_free> context(heif_context_alloc(),heif_context_free); need(bool(context));
    auto security = *heif_context_get_security_limits(context.get());
    need(security.version >= 4, "PHOTO_DECODER_UNAVAILABLE");
    const auto tighten = [](uint64_t existing, uint64_t requested) { return existing ? std::min(existing,requested) : requested; };
    security.max_image_size_pixels = tighten(security.max_image_size_pixels, pixelsLimit);
    security.max_memory_block_size = tighten(security.max_memory_block_size, rasterLimit);
    security.max_color_profile_size = static_cast<uint32_t>(std::min<uint64_t>(UINT32_MAX,tighten(security.max_color_profile_size,inputLimit)));
    // Preserve every other built-in security limit; these are not a total-process heap limit.
    check(heif_context_set_security_limits(context.get(), &security));
    heif_context_set_max_decoding_threads(context.get(),1);
    check(heif_context_read_from_memory_without_copy(context.get(),bytes,size,nullptr));
    heif_item_id primary = 0; check(heif_context_get_primary_image_ID(context.get(),&primary)); need(primary > 0);
    heif_image_handle* handlePtr = nullptr; check(heif_context_get_primary_image_handle(context.get(),&handlePtr));
    std::unique_ptr<heif_image_handle,decltype(&heif_image_handle_release)> handle(handlePtr,heif_image_handle_release);
    need(handle && heif_image_handle_is_primary_image(handle.get()) && heif_image_handle_get_item_id(handle.get()) == primary);
    auto type = heif_item_get_item_type(context.get(),primary);
    need(type == heif_fourcc('h','v','c','1') || type == heif_fourcc('g','r','i','d'), "PHOTO_HEIC_UNSUPPORTED");
    // Auxiliaries include gain maps, depth and alpha: no silent dropped image/color volume.
    need(heif_image_handle_get_number_of_auxiliary_images(handle.get(),0) == 0
      && !heif_image_handle_has_alpha_channel(handle.get()), "PHOTO_HEIC_UNSUPPORTED");
    need(!heif_image_handle_has_content_light_level(handle.get())
      && !heif_image_handle_has_mastering_display_colour_volume(handle.get()), "PHOTO_HDR_UNSUPPORTED");
    const int width = heif_image_handle_get_ispe_width(handle.get()), height = heif_image_handle_get_ispe_height(handle.get());
    need(width >= 2 && height >= 2);
    uint64_t pixels = static_cast<uint64_t>(width) * height;
    need(pixels <= pixelsLimit && pixels <= rasterLimit / 8, "PHOTO_DECODE_LIMIT");
    const int depth = heif_image_handle_get_luma_bits_per_pixel(handle.get());
    need(depth == 8 || depth == 10 || depth == 12, "PHOTO_BIT_DEPTH_UNSUPPORTED");
    need(heif_image_handle_get_chroma_bits_per_pixel(handle.get()) == depth, "PHOTO_BIT_DEPTH_UNSUPPORTED");
    napi_value result = object(env);
    num(env,result,"primary",primary); num(env,result,"width",width); num(env,result,"height",height);
    num(env,result,"displayWidth",heif_image_handle_get_width(handle.get()));
    num(env,result,"displayHeight",heif_image_handle_get_height(handle.get()));
    num(env,result,"bitDepth",depth); num(env,result,"topLevelCount",heif_context_get_number_of_top_level_images(context.get()));
    str(env,result,"version","1.23.2/libde265-1.1.1");
    size_t iccSize = heif_image_handle_get_raw_color_profile_size(handle.get());
    need(iccSize <= inputLimit, "PHOTO_DECODE_LIMIT");
    std::vector<uint8_t> icc(iccSize);
    if (iccSize) check(heif_image_handle_get_raw_color_profile(handle.get(),icc.data()));
    put(env,result,"icc",buffer(env,icc.data(),icc.size()));
    heif_color_profile_nclx* nclxPtr = nullptr;
    auto colorError = heif_image_handle_get_nclx_color_profile(handle.get(),&nclxPtr);
    owned<heif_color_profile_nclx,heif_nclx_color_profile_free> nclx(nclxPtr,heif_nclx_color_profile_free);
    napi_value color; napiCheck(napi_get_null(env,&color));
    if (colorError.code == heif_error_Ok) {
      need(bool(nclx)); color = object(env);
      num(env,color,"primaries",nclx->color_primaries); num(env,color,"transfer",nclx->transfer_characteristics);
      num(env,color,"matrix",nclx->matrix_coefficients); num(env,color,"fullRange",nclx->full_range_flag);
      need(nclx->transfer_characteristics != 16 && nclx->transfer_characteristics != 18, "PHOTO_HDR_UNSUPPORTED");
      // Qualified SDR conversion subset; no unmeasured gamut or transfer conversion.
      need(nclx->color_primaries == 1 && nclx->transfer_characteristics == 13
        && (nclx->matrix_coefficients == 0 || nclx->matrix_coefficients == 1 || nclx->matrix_coefficients == 6), "PHOTO_COLOR_UNSUPPORTED");
    } else need(colorError.code == heif_error_Color_profile_does_not_exist);
    // ICC is observed, but its interpretation is not qualified by this first adapter.
    need(iccSize == 0, "PHOTO_COLOR_UNSUPPORTED");
    put(env,result,"nclx",color);
    // HEIF properties are qualified here; the complete Exif IFD graph is not.
    // Preserve the original for a future adapter instead of guessing priority.
    need(heif_image_handle_get_number_of_metadata_blocks(handle.get(),"Exif") == 0,"PHOTO_GEOMETRY_UNSUPPORTED");
    napi_value grid; napiCheck(napi_get_null(env,&grid));
    if (type == heif_fourcc('g','r','i','d')) {
      heif_image_tiling tiling{}; tiling.version=1;
      check(heif_image_handle_get_image_tiling(handle.get(),0,&tiling));
      uint64_t tiles=static_cast<uint64_t>(tiling.num_columns)*tiling.num_rows;
      need(tiles > 0 && tiles <= 4096 && tiling.number_of_extra_dimensions == 0
        && tiling.image_width == static_cast<uint32_t>(width) && tiling.image_height == static_cast<uint32_t>(height)
        && tiling.left_offset == 0 && tiling.top_offset == 0, "PHOTO_GEOMETRY_UNSUPPORTED");
      need(tiling.tile_width > 0 && tiling.tile_height > 0
        && tiling.num_columns == (static_cast<uint64_t>(width)+tiling.tile_width-1)/tiling.tile_width
        && tiling.num_rows == (static_cast<uint64_t>(height)+tiling.tile_height-1)/tiling.tile_height,"PHOTO_GEOMETRY_UNSUPPORTED");
      need(static_cast<uint64_t>(tiling.tile_width)*tiling.tile_height <= pixelsLimit
        && static_cast<uint64_t>(tiling.tile_width)*tiling.tile_height <= rasterLimit/8,"PHOTO_DECODE_LIMIT");
      grid=object(env); num(env,grid,"columns",tiling.num_columns); num(env,grid,"rows",tiling.num_rows);
      num(env,grid,"tileWidth",tiling.tile_width); num(env,grid,"tileHeight",tiling.tile_height);
      napi_value tileIds; napiCheck(napi_create_array_with_length(env,tiles,&tileIds));
      for (uint32_t y=0; y<tiling.num_rows; y++) for (uint32_t x=0; x<tiling.num_columns; x++) {
        heif_item_id id=0; check(heif_image_handle_get_grid_image_tile_id(handle.get(),0,x,y,&id));
        need(heif_item_get_item_type(context.get(),id) == heif_fourcc('h','v','c','1'),"PHOTO_HEIC_UNSUPPORTED");
        heif_image_handle* tilePtr=nullptr; check(heif_context_get_image_handle(context.get(),id,&tilePtr));
        std::unique_ptr<heif_image_handle,decltype(&heif_image_handle_release)> tile(tilePtr,heif_image_handle_release);
        need(tile && heif_image_handle_get_ispe_width(tile.get()) == static_cast<int>(tiling.tile_width)
          && heif_image_handle_get_ispe_height(tile.get()) == static_cast<int>(tiling.tile_height),"PHOTO_SOURCE_MISMATCH");
        need(heif_item_get_transformation_properties(context.get(),id,nullptr,0) == 0,"PHOTO_GEOMETRY_UNSUPPORTED");
        need(heif_image_handle_get_number_of_metadata_blocks(tile.get(),"Exif") == 0,"PHOTO_GEOMETRY_UNSUPPORTED");
        need(heif_image_handle_get_luma_bits_per_pixel(tile.get()) == depth
          && heif_image_handle_get_chroma_bits_per_pixel(tile.get()) == depth,"PHOTO_BIT_DEPTH_UNSUPPORTED");
        need(!heif_image_handle_has_alpha_channel(tile.get())
          && heif_image_handle_get_number_of_auxiliary_images(tile.get(),0) == 0,"PHOTO_HEIC_UNSUPPORTED");
        need(heif_image_handle_get_raw_color_profile_size(tile.get()) == 0,"PHOTO_COLOR_UNSUPPORTED");
        heif_color_profile_nclx* tileNclxPtr=nullptr;
        auto tileColorError=heif_image_handle_get_nclx_color_profile(tile.get(),&tileNclxPtr);
        owned<heif_color_profile_nclx,heif_nclx_color_profile_free> tileNclx(tileNclxPtr,heif_nclx_color_profile_free);
        if (tileNclx) need(tileNclx->transfer_characteristics != 16 && tileNclx->transfer_characteristics != 18,"PHOTO_HDR_UNSUPPORTED");
        need(!heif_image_handle_has_content_light_level(tile.get())
          && !heif_image_handle_has_mastering_display_colour_volume(tile.get()),"PHOTO_HDR_UNSUPPORTED");
        if (nclx) need(tileColorError.code == heif_error_Ok && tileNclx
          && tileNclx->color_primaries == nclx->color_primaries && tileNclx->transfer_characteristics == nclx->transfer_characteristics
          && tileNclx->matrix_coefficients == nclx->matrix_coefficients && tileNclx->full_range_flag == nclx->full_range_flag,"PHOTO_COLOR_UNSUPPORTED");
        else need(tileColorError.code == heif_error_Color_profile_does_not_exist,"PHOTO_COLOR_UNSUPPORTED");
        napi_value item; napiCheck(napi_create_uint32(env,id,&item)); napiCheck(napi_set_element(env,tileIds,y*tiling.num_columns+x,item));
      }
      put(env,grid,"tileIds",tileIds);
    }
    put(env,result,"grid",grid);
    int propertyCount = heif_item_get_properties_of_type(context.get(),primary,heif_item_property_type_invalid,nullptr,0);
    need(propertyCount >= 0 && propertyCount <= 128,"PHOTO_HEIC_UNSUPPORTED");
    std::vector<heif_property_id> propertyIds(propertyCount);
    need(heif_item_get_properties_of_type(context.get(),primary,heif_item_property_type_invalid,propertyIds.data(),propertyCount) == propertyCount);
    napi_value properties, propertyTypes; napiCheck(napi_create_array_with_length(env,propertyCount,&properties));
    napiCheck(napi_create_array_with_length(env,propertyCount,&propertyTypes));
    for (int i=0; i<propertyCount; i++) {
      napi_value id; napiCheck(napi_create_uint32(env,propertyIds[i],&id)); napiCheck(napi_set_element(env,properties,i,id));
      uint32_t typeCode=static_cast<uint32_t>(heif_item_get_property_type(context.get(),primary,propertyIds[i]));
      char typeName[5]={static_cast<char>(typeCode>>24),static_cast<char>(typeCode>>16),static_cast<char>(typeCode>>8),static_cast<char>(typeCode),0};
      napi_value typeValue; napiCheck(napi_create_string_utf8(env,typeName,4,&typeValue)); napiCheck(napi_set_element(env,propertyTypes,i,typeValue));
    }
    put(env,result,"properties",properties);
    put(env,result,"propertyTypes",propertyTypes);
    int count = heif_item_get_transformation_properties(context.get(),primary,nullptr,0);
    need(count >= 0 && count <= 16, "PHOTO_GEOMETRY_UNSUPPORTED");
    std::vector<heif_property_id> ids(count);
    need(heif_item_get_transformation_properties(context.get(),primary,ids.data(),count) == count);
    napi_value transforms; napiCheck(napi_create_array_with_length(env,count,&transforms));
    for (int i=0; i<count; i++) {
      napi_value op = object(env); num(env,op,"id",ids[i]);
      auto kind = heif_item_get_property_type(context.get(),primary,ids[i]);
      if (kind == heif_item_property_type_transform_rotation) {
        str(env,op,"type","irot"); num(env,op,"value",heif_item_get_property_transform_rotation_ccw(context.get(),primary,ids[i]));
      } else if (kind == heif_item_property_type_transform_mirror) {
        str(env,op,"type","imir"); num(env,op,"value",heif_item_get_property_transform_mirror(context.get(),primary,ids[i]));
      } else if (kind == heif_item_property_type_transform_crop) str(env,op,"type","clap");
      else need(false,"PHOTO_GEOMETRY_UNSUPPORTED");
      napiCheck(napi_set_element(env,transforms,i,op));
    }
    put(env,result,"transforms",transforms);
    if (!shouldDecode) return result;
    owned<heif_decoding_options,heif_decoding_options_free> opts(heif_decoding_options_alloc(),heif_decoding_options_free);
    need(opts && opts->version >= 10, "PHOTO_DECODER_UNAVAILABLE");
    opts->ignore_transformations=1; opts->convert_hdr_to_8bit=0; opts->strict_decoding=1;
    opts->decoder_id="libde265";
    opts->num_codec_threads=1; opts->num_library_threads=1; opts->autocorrect_broken_input=0;
    opts->output_image_nclx_profile_passthrough=1;
    heif_image* imagePtr = nullptr;
    check(heif_decode_image(handle.get(),&imagePtr,heif_colorspace_RGB,
      depth == 8 ? heif_chroma_interleaved_RGB : heif_chroma_interleaved_RRGGBB_BE,opts.get()));
    std::unique_ptr<heif_image,decltype(&heif_image_release)> image(imagePtr,heif_image_release); need(bool(image));
    need(heif_image_get_decoding_warnings(image.get(),0,nullptr,0) == 0);
    // Never size a copy from header dimensions alone. Reject disagreeing decoded planes.
    need(heif_image_get_width(image.get(),heif_channel_interleaved) == width
      && heif_image_get_height(image.get(),heif_channel_interleaved) == height, "PHOTO_SOURCE_MISMATCH");
    need(heif_image_get_bits_per_pixel_range(image.get(),heif_channel_interleaved) == depth, "PHOTO_BIT_DEPTH_UNSUPPORTED");
    heif_color_profile_nclx* decodedNclxPtr = nullptr;
    auto decodedColorError = heif_image_get_nclx_color_profile(image.get(),&decodedNclxPtr);
    owned<heif_color_profile_nclx,heif_nclx_color_profile_free> decodedNclx(decodedNclxPtr,heif_nclx_color_profile_free);
    if (decodedColorError.code == heif_error_Ok) {
      need(bool(decodedNclx));
      need(decodedNclx->transfer_characteristics != 16 && decodedNclx->transfer_characteristics != 18, "PHOTO_HDR_UNSUPPORTED");
      if (nclx) need(decodedNclx->color_primaries == nclx->color_primaries
        && decodedNclx->transfer_characteristics == nclx->transfer_characteristics, "PHOTO_SOURCE_MISMATCH");
    } else need(decodedColorError.code == heif_error_Color_profile_does_not_exist);
    size_t stride=0; const uint8_t* plane = heif_image_get_plane_readonly2(image.get(),heif_channel_interleaved,&stride);
    const size_t rowBytes = static_cast<size_t>(width)*3*(depth == 8 ? 1 : 2);
    need(plane && stride >= rowBytes && stride <= SIZE_MAX/static_cast<size_t>(height));
    napi_value raw; void* rawData;
    napiCheck(napi_create_buffer(env,rowBytes*height,&rawData,&raw));
    for (int y=0; y<height; y++) std::memcpy(static_cast<uint8_t*>(rawData)+y*rowBytes,plane+y*stride,rowBytes);
    put(env,result,"pixels",raw);
    return result;
  } catch (const std::bad_alloc&) { napi_throw_error(env,"PHOTO_DECODE_LIMIT","PHOTO_DECODE_LIMIT"); return nullptr; }
  catch (const std::exception& e) { napi_throw_error(env,e.what(),e.what()); return nullptr; }
}
static napi_value init(napi_env env, napi_value exports) {
  napi_value fn; napiCheck(napi_create_function(env,"decode",NAPI_AUTO_LENGTH,decode,reinterpret_cast<void*>(1),&fn));
  put(env,exports,"decode",fn);
  napiCheck(napi_create_function(env,"probe",NAPI_AUTO_LENGTH,decode,nullptr,&fn));
  put(env,exports,"probe",fn); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
