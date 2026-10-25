package com.motoros.notification;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mock.env.MockEnvironment;

class DeliveryProvidersTest {
  @Test void localSmsAndWhatsappCaptureWithoutExternalProviderCalls(){
    var mail=mock(JavaMailSender.class);var env=new MockEnvironment();env.setActiveProfiles("local");var providers=new DeliveryProviders(mail,env);
    for(String channel:new String[]{"SMS","WHATSAPP"})assertEquals("DEVELOPMENT_CAPTURED",providers.send(channel,UUID.randomUUID(),"synthetic-recipient","Test","Synthetic capture only").status());
    verifyNoInteractions(mail);
  }
  @Test void nonlocalUnconfiguredChannelsAndRealLocalEmailRecipientsFailClosed(){
    var mail=mock(JavaMailSender.class);var production=new DeliveryProviders(mail,new MockEnvironment());
    assertThrows(IllegalArgumentException.class,()->production.send("SMS",UUID.randomUUID(),"synthetic","Test","No send"));
    var env=new MockEnvironment();env.setActiveProfiles("local");var local=new DeliveryProviders(mail,env);
    assertThrows(IllegalArgumentException.class,()->local.send("EMAIL",UUID.randomUUID(),"recipient@example.com","Test","No send"));verifyNoInteractions(mail);
  }
}
