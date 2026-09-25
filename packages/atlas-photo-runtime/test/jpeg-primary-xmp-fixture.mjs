// Synthetic Apple capture/region metadata. No real photo or personal metadata.
export const primaryRegion = `<rdf:li rdf:parseType="Resource">
<mwg-rs:Area rdf:parseType="Resource">
<stArea:y>0.5</stArea:y><stArea:w>0.1</stArea:w><stArea:x>0.3</stArea:x><stArea:h>0.1</stArea:h><stArea:unit>normalized</stArea:unit>
</mwg-rs:Area><mwg-rs:Type>Face</mwg-rs:Type><mwg-rs:Extensions rdf:parseType="Resource">
<apple-fi:AngleInfoYaw>300</apple-fi:AngleInfoYaw><apple-fi:AngleInfoRoll>260</apple-fi:AngleInfoRoll>
<apple-fi:ConfidenceLevel>40</apple-fi:ConfidenceLevel><apple-fi:FaceID>1</apple-fi:FaceID>
</mwg-rs:Extensions></rdf:li>`;
export const primaryXmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
 xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#"
 xmlns:apple-fi="http://ns.apple.com/faceinfo/1.0/"
 xmlns:stDim="http://ns.adobe.com/xap/1.0/sType/Dimensions#"
 xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
<xmp:CreateDate>2026-01-01T12:00:00</xmp:CreateDate><xmp:CreatorTool>18.7.8</xmp:CreatorTool><xmp:ModifyDate>2026-01-01T12:00:00</xmp:ModifyDate>
<mwg-rs:Regions rdf:parseType="Resource"><mwg-rs:RegionList><rdf:Seq>${primaryRegion}</rdf:Seq></mwg-rs:RegionList>
<mwg-rs:AppliedToDimensions rdf:parseType="Resource"><stDim:h>18</stDim:h><stDim:w>24</stDim:w><stDim:unit>pixel</stDim:unit></mwg-rs:AppliedToDimensions>
</mwg-rs:Regions><photoshop:DateCreated>2026-01-01T12:00:00</photoshop:DateCreated>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
