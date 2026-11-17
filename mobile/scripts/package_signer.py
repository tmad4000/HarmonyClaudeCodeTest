"""Bind a package signer pin to each actual top-level XAR signature section."""
import base64
import hashlib
import xml.etree.ElementTree as ET
DS='{http://www.w3.org/2000/09/xmldsig#}'

def require_installer(toc_xml,expected_sha1):
    root=ET.fromstring(toc_xml)
    if root.tag!='xar' or len(root.findall('toc'))!=1:raise ValueError('Unexpected XAR TOC root')
    toc=root.find('toc')
    sections=[n for n in toc if n.tag in ('signature','x-signature')]
    if not sections or len(toc.findall('signature'))>1 or len(toc.findall('x-signature'))>1:
        raise ValueError('Missing or ambiguous actual signature sections')
    leaves=[]
    for section in sections:
        expected_style='RSA' if section.tag=='signature' else 'CMS'
        if section.get('style')!=expected_style:raise ValueError('Unsupported signature style')
        if int(section.findtext('offset','-1'))<0 or int(section.findtext('size','0'))<=0:
            raise ValueError('Invalid signature extent')
        keys=section.findall(DS+'KeyInfo')
        if len(keys)!=1:raise ValueError('Ambiguous signature KeyInfo')
        chains=keys[0].findall(DS+'X509Data')
        if len(chains)!=1:raise ValueError('Ambiguous signature chain')
        certificates=chains[0].findall(DS+'X509Certificate')
        if not certificates or not certificates[0].text:raise ValueError('Missing signature leaf')
        leaf=base64.b64decode(''.join(certificates[0].text.split()),validate=True)
        fingerprint=hashlib.sha1(leaf).hexdigest().upper()
        if fingerprint!=expected_sha1.upper():raise ValueError('Unexpected actual installer signature leaf')
        leaves.append({'section':section.tag,'style':expected_style,'sha1':fingerprint})
    # pkgutil performs actual cryptographic validation of this same package.
    # Requiring every present RSA/CMS signature to use the pin avoids relying on
    # which signature the current OS selects. Unrelated XML certs are ignored.
    return leaves
